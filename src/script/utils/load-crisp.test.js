import { describe, expect, it, vi } from 'vitest';
import { loadCrisp, hideCrisp, showCrisp, CRISP_WEBSITE_ID } from './load-crisp.js';

const CRISP_SRC = 'https://client.crisp.chat/l.js';

// Minimal window/document stand-in — the util only touches these surfaces.
// `readyState: 'complete'` + a synchronous `schedule` keep the injection
// deterministic; pass a custom `schedule` to assert the deferral itself.
function makeWindow() {
  const scripts = [];
  return {
    $crisp: undefined,
    CRISP_WEBSITE_ID: undefined,
    document: {
      readyState: 'complete',
      head: { appendChild: (el) => scripts.push(el) },
      createElement: () => ({ src: '', async: false }),
      querySelector: (selector) => {
        const match = /src="([^"]+)"/.exec(selector);
        const src = match ? match[1] : null;
        return scripts.find((s) => s.src === src) || null;
      },
    },
    addEventListener: vi.fn(),
    scripts,
  };
}

// Run the scheduled callback immediately, so injection is synchronous in tests.
const runNow = (cb) => cb();

describe('loadCrisp', () => {
  it('sets the queue + id synchronously and injects one async script', () => {
    const win = makeWindow();
    const scheduled = loadCrisp(CRISP_WEBSITE_ID, { window: win, schedule: runNow });

    expect(scheduled).toBe(true);
    expect(win.$crisp).toEqual([]);
    expect(win.CRISP_WEBSITE_ID).toBe(CRISP_WEBSITE_ID);
    expect(win.scripts).toHaveLength(1);
    expect(win.scripts[0].src).toBe(CRISP_SRC);
    expect(win.scripts[0].async).toBe(true);
  });

  it('defaults to the exported website id', () => {
    const win = makeWindow();
    loadCrisp(undefined, { window: win, schedule: runNow });
    expect(win.CRISP_WEBSITE_ID).toBe(CRISP_WEBSITE_ID);
  });

  it('is idempotent — a second call injects nothing and returns false', () => {
    const win = makeWindow();
    loadCrisp(CRISP_WEBSITE_ID, { window: win, schedule: runNow });
    const again = loadCrisp(CRISP_WEBSITE_ID, { window: win, schedule: runNow });

    expect(again).toBe(false);
    expect(win.scripts).toHaveLength(1);
  });

  it('defers injection until the scheduled callback runs', () => {
    const win = makeWindow();
    let fire;
    const schedule = (cb) => { fire = cb; };

    const scheduled = loadCrisp(CRISP_WEBSITE_ID, { window: win, schedule });

    expect(scheduled).toBe(true);
    // Globals are set synchronously, but the script is not injected yet.
    expect(win.$crisp).toEqual([]);
    expect(win.scripts).toHaveLength(0);

    fire();
    expect(win.scripts).toHaveLength(1);
  });

  it('waits for the load event when the document is still loading', () => {
    const win = makeWindow();
    win.document.readyState = 'loading';

    loadCrisp(CRISP_WEBSITE_ID, { window: win });

    expect(win.addEventListener).toHaveBeenCalledWith(
      'load',
      expect.any(Function),
      { once: true }
    );
    expect(win.scripts).toHaveLength(0);
  });

  it('no-ops without a website id', () => {
    const win = makeWindow();
    expect(loadCrisp('', { window: win, schedule: runNow })).toBe(false);
    expect(win.$crisp).toBeUndefined();
    expect(win.scripts).toHaveLength(0);
  });

  it('no-ops without a window', () => {
    expect(loadCrisp(CRISP_WEBSITE_ID, { window: null, schedule: runNow })).toBe(false);
  });
});

describe('hideCrisp / showCrisp', () => {
  it('queue the matching Crisp commands', () => {
    const win = makeWindow();
    loadCrisp(CRISP_WEBSITE_ID, { window: win, schedule: runNow });

    hideCrisp(win);
    showCrisp(win);

    expect(win.$crisp).toEqual([
      ['do', 'chat:hide'],
      ['do', 'chat:show'],
    ]);
  });

  it('are safe when Crisp is not initialised', () => {
    const win = makeWindow();
    expect(() => hideCrisp(win)).not.toThrow();
    expect(() => showCrisp(win)).not.toThrow();
    expect(() => hideCrisp(null)).not.toThrow();
  });
});
