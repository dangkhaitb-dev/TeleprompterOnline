import { describe, expect, it } from 'vitest';
import { ensureWebmDuration, isWebmMedia } from './webm-duration.js';

const EBML_HEADER = [0x1a, 0x45, 0xdf, 0xa3, 0x80];
const SEGMENT_UNKNOWN = [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
const TIMECODE_SCALE = [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40];
const TRACKS_AND_CLUSTER = [
  0x16, 0x54, 0xae, 0x6b, 0x80,
  0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
];

function mediaRecorderWebm(infoData = TIMECODE_SCALE, type = 'video/webm;codecs=vp9') {
  const info = [0x15, 0x49, 0xa9, 0x66, 0x80 | infoData.length, ...infoData];
  return new Blob([
    new Uint8Array([...EBML_HEADER, ...SEGMENT_UNKNOWN, ...info, ...TRACKS_AND_CLUSTER]),
  ], { type });
}

describe('WebM duration metadata repair', () => {
  it('adds Duration to a Chrome-style unknown-sized streaming Segment', async () => {
    const input = mediaRecorderWebm();
    const fixed = await ensureWebmDuration(input, 6308);
    const bytes = new Uint8Array(await fixed.arrayBuffer());
    const durationOffset = bytes.findIndex((byte, index) => byte === 0x44 && bytes[index + 1] === 0x89);

    expect(fixed).not.toBe(input);
    expect(fixed.type).toBe(input.type);
    expect(fixed.size).toBe(input.size + 11);
    expect(durationOffset).toBeGreaterThan(0);
    expect(bytes[durationOffset + 2]).toBe(0x88);
    expect(new DataView(bytes.buffer).getFloat64(durationOffset + 3, false)).toBe(6308);
    expect([...bytes.slice(-TRACKS_AND_CLUSTER.length)]).toEqual(TRACKS_AND_CLUSTER);
  });

  it('replaces a positive but stale Duration value', async () => {
    const duration = new Uint8Array(11);
    duration.set([0x44, 0x89, 0x88]);
    new DataView(duration.buffer).setFloat64(3, 2000, false);
    const input = mediaRecorderWebm([...TIMECODE_SCALE, ...duration]);
    const fixed = await ensureWebmDuration(input, 6308);
    const bytes = new Uint8Array(await fixed.arrayBuffer());
    const durationOffset = bytes.findIndex((byte, index) => byte === 0x44 && bytes[index + 1] === 0x89);

    expect(fixed).not.toBe(input);
    expect(fixed.size).toBe(input.size);
    expect(new DataView(bytes.buffer).getFloat64(durationOffset + 3, false)).toBe(6308);
  });

  it('keeps an existing Duration that already matches within timestamp tolerance', async () => {
    const duration = new Uint8Array(11);
    duration.set([0x44, 0x89, 0x88]);
    new DataView(duration.buffer).setFloat64(3, 6295, false);
    const input = mediaRecorderWebm([...TIMECODE_SCALE, ...duration]);

    await expect(ensureWebmDuration(input, 6308)).resolves.toBe(input);
  });

  it('uses TimestampScale ticks instead of assuming milliseconds', async () => {
    const scale = [0x2a, 0xd7, 0xb1, 0x83, 0x1e, 0x84, 0x80]; // 2,000,000 ns
    const input = mediaRecorderWebm(scale);
    const fixed = await ensureWebmDuration(input, 6308);
    const bytes = new Uint8Array(await fixed.arrayBuffer());
    const durationOffset = bytes.findIndex((byte, index) => byte === 0x44 && bytes[index + 1] === 0x89);

    expect(new DataView(bytes.buffer).getFloat64(durationOffset + 3, false)).toBe(3154);
  });

  it('repairs audio-only WebM recordings too', async () => {
    const input = mediaRecorderWebm(TIMECODE_SCALE, 'audio/webm;codecs=opus');
    const fixed = await ensureWebmDuration(input, 2500);
    const bytes = new Uint8Array(await fixed.arrayBuffer());
    const durationOffset = bytes.findIndex((byte, index) => byte === 0x44 && bytes[index + 1] === 0x89);

    expect(fixed).not.toBe(input);
    expect(new DataView(bytes.buffer).getFloat64(durationOffset + 3, false)).toBe(2500);
  });

  it('leaves non-WebM, invalid durations and unfamiliar finite Segments untouched', async () => {
    const mp4 = new Blob(['mp4'], { type: 'video/mp4' });
    const webm = mediaRecorderWebm();
    const finiteSegment = new Blob([
      new Uint8Array([...EBML_HEADER, 0x18, 0x53, 0x80, 0x67, 0x80]),
    ], { type: 'video/webm' });

    await expect(ensureWebmDuration(mp4, 1000)).resolves.toBe(mp4);
    await expect(ensureWebmDuration(webm, 0)).resolves.toBe(webm);
    await expect(ensureWebmDuration(finiteSegment, 1000)).resolves.toBe(finiteSegment);
  });

  it('recognizes video and audio WebM MIME types only', () => {
    expect(isWebmMedia(new Blob([], { type: 'video/webm' }))).toBe(true);
    expect(isWebmMedia(new Blob([], { type: 'video/webm;codecs=vp8,opus' }))).toBe(true);
    expect(isWebmMedia(new Blob([], { type: 'audio/webm' }))).toBe(true);
    expect(isWebmMedia(new Blob([], { type: 'video/mp4' }))).toBe(false);
  });
});
