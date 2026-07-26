// debounce.js — trailing-edge debounce with flush/cancel. Coalesces bursty
// work (e.g. per-keystroke persistence) into one call after a quiet period.
// flush() runs a pending call immediately; cancel() drops it.

export function debounce(fn, waitMs) {
  let timer = null;
  let lastArgs = null;

  const invoke = () => {
    timer = null;
    const args = lastArgs;
    lastArgs = null;
    fn(...args);
  };

  const debounced = (...args) => {
    lastArgs = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(invoke, waitMs);
  };

  debounced.flush = () => {
    if (timer === null) return;
    clearTimeout(timer);
    invoke();
  };

  debounced.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };

  return debounced;
}
