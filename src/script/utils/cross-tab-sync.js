// cross-tab-sync.js — the seam for reflecting another browser tab's changes
// back into this one, for the same origin.
//
// Phase 1 (now): a passive listener over the native `storage` event. The
// browser fires this event in OTHER tabs of the origin whenever localStorage
// changes — and never in the tab that made the write, so there is no echo to
// filter out. Every workspace write already funnels through utils/storage.js →
// LS_WORKSPACES, so no per-write wiring is needed here: a caller just gets told
// "the workspace list changed in another tab" and re-reads.
//
// INVARIANT: this channel only ever signals "state changed elsewhere" — it
// never carries an action/command to replay. Receivers re-read persisted state
// and reconcile their own view; one tab can never make another tab *act*.
//
// Phase 2 (online / multi-user, later): extend or swap this module without
// touching feature code — a BroadcastChannel for ephemeral presence
// (cursors/awareness) and a WebSocket/Yjs transport for live document merge.
// Callers depend only on `onWorkspacesChanged`, so the transport can evolve
// under it. See docs.yjs.dev (y-broadcastchannel / y-websocket / awareness).

import { LS_WORKSPACES } from './storage-keys.js';

// Subscribe to cross-tab writes of the workspaces store. `handler` is invoked
// (no args) whenever another tab changes LS_WORKSPACES. Returns an unsubscribe
// function. No-ops safely off the main thread / in non-browser contexts.
// `target` is injectable for tests; it defaults to `window`.
export function onWorkspacesChanged(handler, { target } = {}) {
  const view = target || (typeof window !== 'undefined' ? window : null);
  if (!view || typeof view.addEventListener !== 'function') return () => {};

  const listener = (event) => {
    // key === null means localStorage.clear() — treat that as a change too.
    if (event && event.key != null && event.key !== LS_WORKSPACES) return;
    handler();
  };

  view.addEventListener('storage', listener);
  return () => view.removeEventListener('storage', listener);
}
