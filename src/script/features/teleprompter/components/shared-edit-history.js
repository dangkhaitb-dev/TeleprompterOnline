// One undo/redo timeline for every DOM editor that represents the same script.
// @rocicorp/undo owns the command stack; this adapter stores immutable document
// snapshots and applies them when a command is undone or redone.

import { UndoManager } from '@rocicorp/undo';

const DEFAULT_LIMIT = 200;

const STATE_DEFAULTS = Object.freeze({
  html: '',
  align: 'left',
  fontSize: '',
  lineHeight: '1.25',
  color: '',
  bold: false,
  italic: false,
  underline: false,
});

function cloneState(state) {
  const value = { ...STATE_DEFAULTS, ...(state || {}) };
  return {
    html: String(value.html || ''),
    align: String(value.align || 'left'),
    fontSize: String(value.fontSize || ''),
    lineHeight: String(value.lineHeight || '1.25'),
    color: String(value.color || ''),
    bold: Boolean(value.bold),
    italic: Boolean(value.italic),
    underline: Boolean(value.underline),
  };
}

function sameState(a, b) {
  return Object.keys(STATE_DEFAULTS).every((key) => a && b && a[key] === b[key]);
}

export function createSharedEditHistory(initialState, {
  limit = DEFAULT_LIMIT,
  onApply,
} = {}) {
  let present = cloneState(initialState);
  const manager = new UndoManager({ maxSize: Math.max(2, Number(limit) || DEFAULT_LIMIT) });

  function current() {
    return cloneState(present);
  }

  function apply(state) {
    present = cloneState(state);
    if (typeof onApply === 'function') onApply(current());
  }

  function commit(state) {
    const next = cloneState(state);
    if (sameState(present, next)) return current();
    const previous = current();
    present = next;
    void manager.add({
      undo: () => apply(previous),
      redo: () => apply(next),
    });
    return current();
  }

  async function undo() {
    if (!manager.canUndo) return null;
    await manager.undo();
    return current();
  }

  async function redo() {
    if (!manager.canRedo) return null;
    await manager.redo();
    return current();
  }

  return {
    current,
    commit,
    undo,
    redo,
    canUndo: () => manager.canUndo,
    canRedo: () => manager.canRedo,
  };
}
