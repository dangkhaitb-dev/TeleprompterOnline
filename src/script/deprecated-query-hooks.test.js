// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bootTeleprompter: vi.fn(() => Promise.resolve()),
  createScratchWorkspace: vi.fn(),
  loadWorkspace: vi.fn(),
}));

vi.mock('./features/teleprompter/teleprompter-boot.ui.js', () => ({
  bootTeleprompter: mocks.bootTeleprompter,
}));

vi.mock('./features/teleprompter/teleprompter.logic.js', () => ({
  createScratchWorkspace: mocks.createScratchWorkspace,
  loadWorkspace: mocks.loadWorkspace,
}));

vi.mock('./libs/firebase/button-click-analytics.ui.js', () => ({
  initButtonClickTracking: vi.fn(),
}));

vi.mock('./utils/release-pointer-button-focus.js', () => ({
  releasePointerButtonFocus: vi.fn(),
}));

describe('deprecated URL query hooks', () => {
  let storedValues;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    storedValues = new Map();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key) => storedValues.get(key) ?? null),
      setItem: vi.fn((key, value) => storedValues.set(key, String(value))),
    });
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('ignores seed and notch while preserving the requested workspace', async () => {
    const workspace = { id: 'workspace-123' };
    const notchControl = document.createElement('button');
    notchControl.id = 'notchControl';
    const click = vi.spyOn(notchControl, 'click');
    document.body.append(notchControl);
    window.history.replaceState(null, '', '/teleprompter?ws=workspace-123&seed&notch');
    mocks.loadWorkspace.mockReturnValue(workspace);

    await import('./teleprompter-main.js');
    await vi.runAllTimersAsync();

    expect(mocks.loadWorkspace).toHaveBeenCalledWith('workspace-123');
    expect(mocks.createScratchWorkspace).not.toHaveBeenCalled();
    expect(mocks.bootTeleprompter).toHaveBeenCalledWith({ workspace });
    expect(storedValues.has('solprompter:folders')).toBe(false);
    expect(storedValues.has('solprompter:workspaces')).toBe(false);
    expect(storedValues.has('solprompter:ws-seeded')).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it('does not seed demo library data from the workspaces page', async () => {
    window.history.replaceState(null, '', '/workspaces?seed');
    const { initWorkspacesUI } = await import('./features/workspaces/workspaces.ui.js');

    initWorkspacesUI();

    expect(storedValues.has('solprompter:folders')).toBe(false);
    expect(storedValues.has('solprompter:workspaces')).toBe(false);
    expect(storedValues.has('solprompter:ws-seeded')).toBe(false);
  });
});
