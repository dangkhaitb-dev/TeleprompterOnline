// Chrome writes MediaRecorder WebM files as live/streaming containers and
// commonly leaves the EBML Duration field unset. The packets are intact, but
// downloaded files then report Infinity/an incorrect length.
//
// Repair only the small metadata prefix. The encoded media body stays as a
// Blob.slice(), so a multi-GB OPFS-backed recording is never copied into RAM.

const HEADER_SCAN_BYTES = 1024 * 1024;
const SEGMENT_ID = Object.freeze([0x18, 0x53, 0x80, 0x67]);
const INFO_ID = Object.freeze([0x15, 0x49, 0xa9, 0x66]);
const SEEK_HEAD_ID = Object.freeze([0x11, 0x4d, 0x9b, 0x74]);
const CLUSTER_ID = Object.freeze([0x1f, 0x43, 0xb6, 0x75]);
const DURATION_ID = Object.freeze([0x44, 0x89]);
const TIMESTAMP_SCALE_ID = Object.freeze([0x2a, 0xd7, 0xb1]);
const DURATION_FLOAT_BYTES = 8;
const DEFAULT_TIMESTAMP_SCALE_NS = 1_000_000;
const DURATION_MATCH_TOLERANCE_MS = 20;

export function isWebmMedia(blob) {
  return blob instanceof Blob && /^(?:video|audio)\/webm(?:;|$)/i.test(blob.type || '');
}

function findBytes(bytes, pattern, from = 0, to = bytes.length) {
  const end = Math.min(to, bytes.length) - pattern.length;
  for (let offset = Math.max(0, from); offset <= end; offset += 1) {
    let matches = true;
    for (let index = 0; index < pattern.length; index += 1) {
      if (bytes[offset + index] !== pattern[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return offset;
  }
  return -1;
}

// EBML variable-size integer. The marker bit encodes the byte length and is
// not part of the value. An all-ones value means "unknown size".
function readVint(bytes, offset) {
  const first = bytes[offset];
  if (first === undefined || first === 0) return null;
  let length = 1;
  let marker = 0x80;
  while (length <= 8 && !(first & marker)) {
    marker >>= 1;
    length += 1;
  }
  if (length > 8 || offset + length > bytes.length) return null;
  let value = BigInt(first & (marker - 1));
  for (let index = 1; index < length; index += 1) {
    value = (value << 8n) | BigInt(bytes[offset + index]);
  }
  const unknownValue = (1n << BigInt(length * 7)) - 1n;
  return { length, value, unknown: value === unknownValue };
}

function encodeSizeVint(value, preferredLength) {
  const size = BigInt(value);
  let length = Math.max(1, preferredLength || 1);
  while (length <= 8) {
    // Reserve the all-ones value for "unknown size".
    const maxFiniteValue = (1n << BigInt(length * 7)) - 2n;
    if (size <= maxFiniteValue) break;
    length += 1;
  }
  if (length > 8) return null;
  let encoded = size | (1n << BigInt(length * 7));
  const bytes = new Uint8Array(length);
  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[index] = Number(encoded & 0xffn);
    encoded >>= 8n;
  }
  return bytes;
}

function idLength(bytes, offset) {
  return readVint(bytes, offset)?.length || 0;
}

function sameId(bytes, offset, id) {
  if (offset + id.length > bytes.length) return false;
  return id.every((byte, index) => bytes[offset + index] === byte);
}

function readUnsignedInteger(bytes, offset, length) {
  if (length < 1 || length > 8 || offset + length > bytes.length) return null;
  let value = 0n;
  for (let index = 0; index < length; index += 1) {
    value = (value << 8n) | BigInt(bytes[offset + index]);
  }
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

function inspectInfoElements(bytes, start, end) {
  let duration = null;
  let timestampScaleNs = DEFAULT_TIMESTAMP_SCALE_NS;
  let offset = start;
  while (offset < end) {
    const elementIdLength = idLength(bytes, offset);
    if (!elementIdLength) return null;
    const sizeOffset = offset + elementIdLength;
    const size = readVint(bytes, sizeOffset);
    if (!size || size.unknown || size.value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    const dataOffset = sizeOffset + size.length;
    const dataEnd = dataOffset + Number(size.value);
    if (dataEnd > end) return null;
    if (elementIdLength === DURATION_ID.length && sameId(bytes, offset, DURATION_ID)) {
      duration = { dataOffset, size: Number(size.value) };
    } else if (
      elementIdLength === TIMESTAMP_SCALE_ID.length
      && sameId(bytes, offset, TIMESTAMP_SCALE_ID)
    ) {
      const parsedScale = readUnsignedInteger(bytes, dataOffset, Number(size.value));
      if (parsedScale > 0) timestampScaleNs = parsedScale;
    }
    offset = dataEnd;
  }
  return { duration, timestampScaleNs };
}

function durationElement(durationMs) {
  const bytes = new Uint8Array(2 + 1 + DURATION_FLOAT_BYTES);
  bytes.set(DURATION_ID, 0);
  bytes[2] = 0x80 | DURATION_FLOAT_BYTES;
  new DataView(bytes.buffer).setFloat64(3, durationMs, false);
  return bytes;
}

function withOriginalType(parts, blob) {
  return new Blob(parts, { type: blob.type || 'video/webm' });
}

// Add or replace the WebM Info > Duration value. Fail open on an unfamiliar
// container: preserving a playable original is safer than guessing at offsets.
export async function ensureWebmDuration(blob, durationMs) {
  const duration = Number(durationMs);
  if (!isWebmMedia(blob) || !Number.isFinite(duration) || duration <= 0) return blob;

  try {
    const scanSize = Math.min(blob.size, HEADER_SCAN_BYTES);
    const header = new Uint8Array(await blob.slice(0, scanSize).arrayBuffer());
    const segmentOffset = findBytes(header, SEGMENT_ID);
    if (segmentOffset < 0) return blob;

    const segmentSizeOffset = segmentOffset + SEGMENT_ID.length;
    const segmentSize = readVint(header, segmentSizeOffset);
    if (!segmentSize) return blob;
    const segmentDataOffset = segmentSizeOffset + segmentSize.length;

    const infoOffset = findBytes(header, INFO_ID, segmentDataOffset);
    if (infoOffset < 0) return blob;
    const infoSizeOffset = infoOffset + INFO_ID.length;
    const infoSize = readVint(header, infoSizeOffset);
    if (!infoSize || infoSize.unknown || infoSize.value > BigInt(Number.MAX_SAFE_INTEGER)) {
      return blob;
    }
    const infoDataOffset = infoSizeOffset + infoSize.length;
    const infoEnd = infoDataOffset + Number(infoSize.value);
    if (infoEnd > header.length) return blob;

    const { duration: existing, timestampScaleNs } =
      inspectInfoElements(header, infoDataOffset, infoEnd);
    const durationTicks = duration * DEFAULT_TIMESTAMP_SCALE_NS / timestampScaleNs;
    if (!Number.isFinite(durationTicks) || durationTicks <= 0) return blob;

    if (existing && (existing.size === 4 || existing.size === 8)) {
      const current = new DataView(
        header.buffer,
        header.byteOffset + existing.dataOffset,
        existing.size,
      )[existing.size === 4 ? 'getFloat32' : 'getFloat64'](0, false);
      const currentMs = current * timestampScaleNs / DEFAULT_TIMESTAMP_SCALE_NS;
      if (
        Number.isFinite(currentMs)
        && currentMs > 0
        && Math.abs(currentMs - duration) <= DURATION_MATCH_TOLERANCE_MS
      ) {
        return blob;
      }
      const repairedHeader = header.slice(0, infoEnd);
      new DataView(
        repairedHeader.buffer,
        repairedHeader.byteOffset + existing.dataOffset,
        existing.size,
      )[existing.size === 4 ? 'setFloat32' : 'setFloat64'](0, durationTicks, false);
      return withOriginalType([repairedHeader, blob.slice(infoEnd)], blob);
    }

    // Inserting bytes changes all following segment-relative offsets. Chrome's
    // streaming output uses an unknown-sized Segment without SeekHead; only
    // that layout is safe to extend without rebuilding Cues/seek indexes.
    if (!segmentSize.unknown) return blob;
    const clusterOffset = findBytes(header, CLUSTER_ID, infoEnd);
    const metadataEnd = clusterOffset >= 0 ? clusterOffset : header.length;
    if (findBytes(header, SEEK_HEAD_ID, segmentDataOffset, metadataEnd) >= 0) return blob;

    const addition = durationElement(durationTicks);
    const nextInfoSize = encodeSizeVint(Number(infoSize.value) + addition.length, infoSize.length);
    if (!nextInfoSize) return blob;
    return withOriginalType([
      header.slice(0, infoSizeOffset),
      nextInfoSize,
      header.slice(infoDataOffset, infoEnd),
      addition,
      blob.slice(infoEnd),
    ], blob);
  } catch {
    return blob;
  }
}
