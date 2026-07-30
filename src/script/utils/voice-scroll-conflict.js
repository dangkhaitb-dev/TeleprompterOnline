// Ephemeral, origin-scoped notification for browser-level speech-recognition
// contention. It carries diagnostics only; receiving tabs never replay Play,
// Record, or Auto actions from another tab.

const CHANNEL_NAME = 'solprompter:voice-scroll-conflict:v1';
const CONFLICT_MESSAGE = 'recognizer-busy';

export function createVoiceScrollConflictChannel({ BroadcastChannelImpl } = {}) {
  const Channel = BroadcastChannelImpl === undefined
    ? globalThis.BroadcastChannel
    : BroadcastChannelImpl;
  const listeners = new Set();
  let channel = null;

  try {
    if (typeof Channel === 'function') channel = new Channel(CHANNEL_NAME);
  } catch {
    channel = null;
  }

  const onMessage = (event) => {
    if (event?.data?.type !== CONFLICT_MESSAGE) return;
    for (const listener of listeners) listener();
  };
  channel?.addEventListener('message', onMessage);

  return {
    publish() {
      try {
        channel?.postMessage({ type: CONFLICT_MESSAGE });
      } catch { /* best-effort cross-tab diagnostic */ }
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      listeners.clear();
      channel?.removeEventListener('message', onMessage);
      try { channel?.close(); } catch { /* best-effort cleanup */ }
      channel = null;
    },
  };
}
