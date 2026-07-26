// export-data.js — pure helpers shared by JSON and ZIP export flows.

export function createJsonBlob(value) {
  return new Blob([`${JSON.stringify(value, null, 2)}\n`], {
    type: 'application/json;charset=utf-8',
  });
}

export function isoDateStamp(value = Date.now()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'backup';
  return date.toISOString().slice(0, 10);
}

// ZIP entry names must never allow user/source data to create nested paths.
export function safeZipSegment(value, fallback = 'item') {
  const printable = [...String(value || '')]
    .filter((character) => character.charCodeAt(0) >= 32)
    .join('');
  const cleaned = printable
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^-+|-+$/g, '')
    .trim();
  return cleaned || fallback;
}
