// reading-session-controller.js — the single owner of teleprompter reading
// lifecycle. Play and Record arm the same session; layout/capture gates decide
// when scrolling may start, and every camera/notch change is rebound here.

export function createReadingSessionController({
  scroller,
  getSurface,
  prepareSurface,
  getScrollMode,
  configureScroll,
  startVoiceScroll,
  stopVoiceScroll,
  isVoiceScrollRunning,
} = {}) {
  let kind = 'idle';
  let surface = null;
  let wantsScroll = false;
  let paused = false;
  let restartOnStart = true;
  let gates = new Set();

  const currentSurface = () => (getSurface && getSurface()) || null;
  const voiceRunning = () => Boolean(isVoiceScrollRunning && isVoiceScrollRunning());
  const engineRunning = () => Boolean((scroller && scroller.isScrolling()) || voiceRunning());

  function stopEngines() {
    if (scroller) scroller.stop();
    if (stopVoiceScroll) stopVoiceScroll();
  }

  function bind(next = currentSurface()) {
    if (!next) return null;
    surface = next;
    if (scroller && scroller.bindSurface) scroller.bindSurface(next);
    return surface;
  }

  function prepare(next, restart) {
    if (!next || !prepareSurface) return false;
    return prepareSurface(next, restart);
  }

  function startEngine({ restart = false, alreadyPrepared = false } = {}) {
    if (kind === 'idle' || paused || !wantsScroll || gates.size) return false;
    const next = currentSurface();
    if (!next) return false;
    if (next !== surface) {
      stopEngines();
      bind(next);
    }
    if (!alreadyPrepared && !prepare(next, restart)) return false;
    // prepareSurface changes padding/tail and therefore scrollHeight. Rebind
    // after it so timed mode and the first frame use a freshly measured extent.
    if (!alreadyPrepared && scroller && scroller.bindSurface) scroller.bindSurface(next);

    const mode = getScrollMode ? getScrollMode() : 'wpm';
    if (mode === 'auto') {
      if (scroller) scroller.stop();
      if (startVoiceScroll) void startVoiceScroll();
      return true;
    }

    if (stopVoiceScroll) stopVoiceScroll();
    if (configureScroll) configureScroll(mode, next);
    if (scroller) scroller.start(next);
    return true;
  }

  function begin(nextKind, { waitFor = [], restart = true } = {}) {
    stopEngines();
    kind = nextKind;
    paused = false;
    wantsScroll = true;
    restartOnStart = restart;
    gates = new Set(waitFor);
    bind(currentSurface());
    if (!gates.size) startEngine({ restart: restartOnStart });
  }

  function release(gate) {
    if (kind === 'idle' || !gates.has(gate)) return;
    gates.delete(gate);
    if (!gates.size) {
      const restart = restartOnStart;
      restartOnStart = false;
      startEngine({ restart });
    }
  }

  function toggleScroll() {
    if (kind === 'idle') return false;
    if (engineRunning()) {
      wantsScroll = false;
      stopEngines();
      return false;
    }
    wantsScroll = true;
    paused = false;
    if (!gates.size) startEngine({ restart: false });
    return true;
  }

  function pause() {
    if (kind === 'idle') return;
    paused = true;
    wantsScroll = false;
    stopEngines();
  }

  function stopScroll() {
    if (kind === 'idle') return;
    wantsScroll = false;
    stopEngines();
  }

  function resume() {
    if (kind === 'idle') return;
    paused = false;
    wantsScroll = true;
    if (!gates.size) startEngine({ restart: false });
  }

  function restart() {
    if (kind === 'idle') return;
    stopEngines();
    paused = false;
    wantsScroll = true;
    startEngine({ restart: true });
  }

  function refreshMode() {
    if (kind === 'idle' || paused || !wantsScroll || gates.size) return;
    stopEngines();
    startEngine({ restart: false });
  }

  function progressOf(target) {
    if (!target) return 0;
    const max = Math.max(0, target.scrollHeight - target.clientHeight);
    return max > 0 ? Math.max(0, Math.min(1, target.scrollTop / max)) : 0;
  }

  // Rebind a live session without leaking pixel coordinates between differently
  // sized surfaces. The normalized content progress is preserved instead.
  function switchSurface(next = currentSurface(), { preserveProgress = true } = {}) {
    if (!next || next === surface) return;
    const previous = surface;
    const progress = preserveProgress ? progressOf(previous) : 0;
    const shouldResume = kind !== 'idle' && wantsScroll && !paused && gates.size === 0;

    stopEngines();
    bind(next);

    if (kind === 'idle' || gates.size) {
      if (!preserveProgress) {
        next.scrollTop = 0;
        bind(next);
      }
      return;
    }

    if (!prepare(next, false)) return;
    const max = Math.max(0, next.scrollHeight - next.clientHeight);
    next.scrollTop = preserveProgress ? progress * max : 0;
    bind(next);
    if (shouldResume) startEngine({ restart: false, alreadyPrepared: true });
  }

  function stop() {
    stopEngines();
    kind = 'idle';
    surface = null;
    wantsScroll = false;
    paused = false;
    restartOnStart = true;
    gates.clear();
  }

  function continueAsPlay() {
    if (kind === 'idle') return;
    kind = 'play';
    paused = false;
  }

  return {
    begin,
    release,
    toggleScroll,
    pause,
    stopScroll,
    resume,
    restart,
    refreshMode,
    switchSurface,
    stop,
    continueAsPlay,
    isActive: () => kind !== 'idle',
    isScrolling: engineRunning,
    getKind: () => kind,
    getSurface: () => surface,
    getPendingGates: () => Array.from(gates),
  };
}
