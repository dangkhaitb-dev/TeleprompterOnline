// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountSceneEditor } from './scene-editor.ui.js';
import * as logic from './scene-editor.logic.js';
import { getItem, setItem, removeItem } from '../../utils/storage.js';
import { LS_SE_FIRST_VISIT_TOUR } from '../../utils/storage-keys.js';

vi.mock('./scene-editor.logic.js', () => ({
  loadScenes: vi.fn(),
  exportableScenes: vi.fn(),
  exportButtonIntent: vi.fn(),
}));

describe('Scene Editor First Visit Tour', () => {
  let container;
  let teardown;
  let values;

  function stubLocalStorage() {
    values = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key) => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
      clear: () => values.clear(),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    stubLocalStorage();
    container = document.createElement('div');
    document.body.appendChild(container);
    removeItem(LS_SE_FIRST_VISIT_TOUR);
  });

  afterEach(() => {
    if (typeof teardown === 'function') teardown();
    teardown = null;
    container?.remove();
    document.body.innerHTML = '';
    removeItem(LS_SE_FIRST_VISIT_TOUR);
    vi.unstubAllGlobals();
  });

  it('shows first visit tour when scenes are loaded for the first time', async () => {
    // Mock loadScenes to return at least one scene with a blob
    const mockScene = { id: 'take-1', kind: 'video', blob: new Blob([''], { type: 'video/webm' }), duration: 5000 };
    vi.mocked(logic.loadScenes).mockResolvedValue([mockScene]);
    vi.mocked(logic.exportableScenes).mockReturnValue([mockScene]);
    vi.mocked(logic.exportButtonIntent).mockReturnValue('direct');

    teardown = await mountSceneEditor(container, {
      workspaceId: 'ws-1',
      copy: {
        tour: {
          label: 'Test Editor Tour',
          skip: 'Skip Test',
          exportButton: 'Click here to export',
        },
      },
    });

    // Check if the tour popup and overlay are rendered
    const overlay = document.querySelector('.first-visit-tour-overlay');
    const popup = document.querySelector('.first-visit-tour-popup');
    expect(overlay).not.toBeNull();
    expect(popup).not.toBeNull();
    expect(popup.textContent).toContain('Click here to export');

    // Click skip to close
    const skipBtn = popup.querySelector('.first-visit-tour-skip');
    skipBtn.click();

    // Verify tour is removed and storage key is set to true
    expect(document.querySelector('.first-visit-tour-overlay')).toBeNull();
    expect(getItem(LS_SE_FIRST_VISIT_TOUR)).toBe(true);
  });

  it('does not show tour if already seen', async () => {
    setItem(LS_SE_FIRST_VISIT_TOUR, true);
    const mockScene = { id: 'take-1', kind: 'video', blob: new Blob([''], { type: 'video/webm' }), duration: 5000 };
    vi.mocked(logic.loadScenes).mockResolvedValue([mockScene]);
    vi.mocked(logic.exportableScenes).mockReturnValue([mockScene]);
    vi.mocked(logic.exportButtonIntent).mockReturnValue('direct');

    teardown = await mountSceneEditor(container, {
      workspaceId: 'ws-1',
      copy: {},
    });

    expect(document.querySelector('.first-visit-tour-overlay')).toBeNull();
  });

  it('opens immediately while the stopped recording is still being saved', async () => {
    setItem(LS_SE_FIRST_VISIT_TOUR, true);
    const savedScene = {
      id: 'take-saving',
      kind: 'video',
      blob: new Blob(['video'], { type: 'video/mp4' }),
      duration: 5000,
    };
    let resolveSave;
    const pendingSave = new Promise((resolve) => { resolveSave = resolve; });
    vi.mocked(logic.loadScenes)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([savedScene]);
    vi.mocked(logic.exportableScenes).mockReturnValue([savedScene]);
    vi.mocked(logic.exportButtonIntent).mockReturnValue('direct');

    teardown = await mountSceneEditor(container, {
      workspaceId: 'ws-saving',
      copy: { saving: 'Finalizing test recording…' },
      pendingSave,
    });

    expect(container.querySelector('.se-saving-preview')?.textContent)
      .toContain('Finalizing test recording…');

    resolveSave(savedScene);

    await vi.waitFor(() => {
      expect(container.querySelector('.se-saving-preview')).toBeNull();
      expect(container.querySelector('video')).not.toBeNull();
    });
    expect(logic.loadScenes).toHaveBeenCalledTimes(2);
  });

  it('replaces the saving placeholder when the post-save reload fails', async () => {
    setItem(LS_SE_FIRST_VISIT_TOUR, true);
    const savedRecord = {
      id: 'take-saved',
      blob: new Blob(['video'], { type: 'video/mp4' }),
    };
    vi.mocked(logic.loadScenes)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new DOMException('database unavailable', 'UnknownError'));

    teardown = await mountSceneEditor(container, {
      workspaceId: 'ws-reload-error',
      copy: { loadError: 'Could not load the saved recording.', retry: 'Retry load' },
      pendingSave: Promise.resolve(savedRecord),
    });

    await vi.waitFor(() => {
      expect(container.querySelector('.se-saving-preview')).toBeNull();
      expect(container.querySelector('[role="alert"]')?.textContent)
        .toContain('Could not load the saved recording.');
    });
  });

  it('replaces an indefinitely pending save with a recoverable delayed state', async () => {
    vi.useFakeTimers();
    try {
      setItem(LS_SE_FIRST_VISIT_TOUR, true);
      vi.mocked(logic.loadScenes).mockResolvedValue([]);

      teardown = await mountSceneEditor(container, {
        workspaceId: 'ws-save-stalled',
        copy: {
          saving: 'Saving recording…',
          savingDelayed: 'Saving is taking longer than expected.',
          retry: 'Keep waiting',
        },
        pendingSave: new Promise(() => {}),
      });

      await vi.advanceTimersByTimeAsync(60_000);

      expect(container.querySelector('.se-saving-preview')).toBeNull();
      expect(container.querySelector('[role="alert"]')?.textContent)
        .toContain('Saving is taking longer than expected.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows video loading feedback until a frame is ready', async () => {
    setItem(LS_SE_FIRST_VISIT_TOUR, true);
    const mockScene = {
      id: 'take-loading',
      kind: 'video',
      blob: new Blob(['video'], { type: 'video/mp4' }),
      duration: 5000,
    };
    vi.mocked(logic.loadScenes).mockResolvedValue([mockScene]);
    vi.mocked(logic.exportableScenes).mockReturnValue([mockScene]);
    vi.mocked(logic.exportButtonIntent).mockReturnValue('direct');

    teardown = await mountSceneEditor(container, {
      workspaceId: 'ws-loading',
      copy: {},
    });

    const video = container.querySelector('video');
    expect(container.querySelector('.se-media-status.is-loading')).not.toBeNull();

    video.dispatchEvent(new Event('loadeddata'));

    expect(container.querySelector('.se-media-status')).toBeNull();
  });

  it('replaces a failed video preview with retry and download actions', async () => {
    setItem(LS_SE_FIRST_VISIT_TOUR, true);
    const mockScene = {
      id: 'take-error',
      kind: 'video',
      blob: new Blob(['video'], { type: 'video/mp4' }),
      duration: 5000,
    };
    vi.mocked(logic.loadScenes).mockResolvedValue([mockScene]);
    vi.mocked(logic.exportableScenes).mockReturnValue([mockScene]);
    vi.mocked(logic.exportButtonIntent).mockReturnValue('direct');

    teardown = await mountSceneEditor(container, {
      workspaceId: 'ws-error',
      copy: {},
    });

    const failedVideo = container.querySelector('video');
    failedVideo.dispatchEvent(new Event('error'));

    const errorState = container.querySelector('.se-media-status.is-error');
    expect(errorState).not.toBeNull();
    expect(errorState.querySelector('.se-media-status-code').textContent)
      .toBe('PLAYBACK_UNKNOWN');
    expect(errorState.querySelector('[data-role="preview-retry"]')).not.toBeNull();
    expect(errorState.querySelector('[data-role="preview-download"]')).not.toBeNull();
    expect(errorState.querySelector('[data-role="preview-copy"]')).not.toBeNull();

    errorState.querySelector('[data-role="preview-retry"]').click();

    expect(container.querySelector('video')).not.toBe(failedVideo);
    expect(container.querySelector('.se-media-status.is-loading')).not.toBeNull();
  });
});
