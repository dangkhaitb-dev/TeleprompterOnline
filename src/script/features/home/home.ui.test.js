// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startFromScript: vi.fn(),
  readTextFile: vi.fn(),
  openTeleprompterOverlay: vi.fn(),
  preloadTeleprompterOverlay: vi.fn(),
  initFileDragDrop: vi.fn(),
}));

vi.mock('./home.logic.js', () => ({ startFromScript: mocks.startFromScript }));
vi.mock('../../utils/read-text-file.js', () => ({ readTextFile: mocks.readTextFile }));
vi.mock('../../utils/drag-drop.js', () => ({ initFileDragDrop: mocks.initFileDragDrop }));
vi.mock('../../utils/prefetch-page.js', () => ({
  fetchPageHtml: () => Promise.resolve(''),
  prefetchPageAssets: () => Promise.resolve(),
}));
vi.mock('../teleprompter/teleprompter-overlay.ui.js', () => ({
  openTeleprompterOverlay: mocks.openTeleprompterOverlay,
  preloadTeleprompterOverlay: mocks.preloadTeleprompterOverlay,
}));
vi.mock('./mobile-nav.ui.js', () => ({ initMobileNav: vi.fn() }));
vi.mock('./language-switcher.ui.js', () => ({ initLanguageSwitcher: vi.fn() }));

import { initHomeUI } from './home.ui.js';

function renderHome() {
  document.body.innerHTML = `
    <form id="composerForm" data-msg-empty="Add a script first." data-msg-read="Could not read that file.">
      <input type="file" id="file-input">
      <textarea id="paste-textarea"></textarea>
      <button id="upload-btn" type="button"></button>
      <button id="start-btn" type="submit"></button>
      <p id="paste-error-box" hidden></p>
    </form>
    <div id="drag-overlay"></div>
  `;
}

describe('home file composer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderHome();
    mocks.startFromScript.mockReturnValue({ ok: true, workspace: { id: 'ws-uploaded' } });
    mocks.readTextFile.mockResolvedValue('Uploaded script');
    mocks.openTeleprompterOverlay.mockResolvedValue({});
    mocks.preloadTeleprompterOverlay.mockResolvedValue(undefined);
  });

  it('submits a selected file automatically after reading it', async () => {
    initHomeUI();
    const file = new File(['Uploaded script'], 'script.txt', { type: 'text/plain' });
    const input = document.getElementById('file-input');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });

    input.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => expect(mocks.startFromScript).toHaveBeenCalledWith('Uploaded script'));
    await vi.dynamicImportSettled();
    expect(mocks.readTextFile).toHaveBeenCalledWith(file);
    expect(mocks.startFromScript).toHaveBeenCalledWith('Uploaded script');
  });

  it('submits files dropped onto the composer automatically after reading them', async () => {
    initHomeUI();
    const { onFile } = mocks.initFileDragDrop.mock.calls[0][0];
    const file = new File(['Dropped script'], 'dropped.md', { type: 'text/markdown' });
    mocks.readTextFile.mockResolvedValueOnce('Dropped script');

    await onFile(file);

    expect(mocks.startFromScript).toHaveBeenCalledWith('Dropped script');
  });
});
