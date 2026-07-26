// ID lookup scoped to a root that is either the Document (standalone page) or
// an Element (the in-page teleprompter overlay). `getElementById` only exists
// on Document, so both cases go through querySelector. `CSS.escape` is missing
// in some DOM environments (jsdom); fall back to escaping selector metachars.
const escapeId = (id) => (
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(id)
    : String(id).replace(/[^a-zA-Z0-9_-]/g, '\\$&')
);
export const scopedId = (root) => (id) => root.querySelector(`#${escapeId(id)}`);
