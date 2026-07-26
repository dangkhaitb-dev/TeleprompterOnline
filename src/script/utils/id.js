// id.js — small unique-id helper. Prefer crypto.randomUUID; fall back for
// older/insecure contexts so ids stay collision-safe enough for local records.

export function makeId(prefix = 'id') {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${rand}`;
}
