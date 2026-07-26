// fullscreen.js — thin cross-browser wrapper around the Fullscreen API.
// requestFullscreen requires a user gesture; callers invoke enter() from a
// click/tap handler. Safari still needs the webkit-prefixed variants.

export function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

export function enterFullscreen(element = document.documentElement) {
  if (isFullscreen()) return Promise.resolve();
  const request = element.requestFullscreen || element.webkitRequestFullscreen;
  if (!request) return Promise.reject(new Error('Fullscreen unsupported'));
  try {
    const result = request.call(element);
    return result && typeof result.then === 'function' ? result : Promise.resolve();
  } catch (err) {
    return Promise.reject(err);
  }
}

export function exitFullscreen() {
  if (!isFullscreen()) return Promise.resolve();
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  if (!exit) return Promise.resolve();
  try {
    const result = exit.call(document);
    return result && typeof result.then === 'function' ? result : Promise.resolve();
  } catch {
    return Promise.resolve();
  }
}

export function toggleFullscreen(element = document.documentElement) {
  return isFullscreen() ? exitFullscreen() : enterFullscreen(element);
}

// Subscribe to fullscreen changes; returns an unsubscribe function.
export function onFullscreenChange(handler) {
  document.addEventListener('fullscreenchange', handler);
  document.addEventListener('webkitfullscreenchange', handler);
  return () => {
    document.removeEventListener('fullscreenchange', handler);
    document.removeEventListener('webkitfullscreenchange', handler);
  };
}
