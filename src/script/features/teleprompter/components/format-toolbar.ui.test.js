// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initFormatToolbar } from './format-toolbar.ui.js';

describe('shared format toolbar controller', () => {
  let controller;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="app" class="notch-on">
        <div class="format-toolbar">
          <select class="ft-line-height"><option value="1.25">Line 1.25</option><option value="1.5">Line 1.5</option></select>
        </div>
        <div class="format-toolbar">
          <select class="ft-line-height"><option value="1.25">Line 1.25</option><option value="1.5">Line 1.5</option></select>
        </div>
        <div id="promptBox" contenteditable="true">Prompt text</div>
        <div id="teleprompterText" contenteditable="true">Popup text</div>
        <div id="notchEditPanel" class="show">
          <div id="notchEditToolbar">
            <select id="notchEditFontSize"><option value="24" selected>24</option><option value="32">32</option></select>
            <select id="notchEditLineHeight"><option value="1.25" selected>Line 1.25</option><option value="1.5">Line 1.5</option></select>
            <button data-cmd="bold">B</button>
            <button data-cmd="underline">U</button>
            <button id="notchEditColorTrigger"></button>
            <span id="notchEditColorBar"></span>
            <button class="notch-edit-align" data-align="left"></button>
          </div>
          <div id="notchEditText" contenteditable="true">Notch text</div>
        </div>
      </div>
    `;
    document.execCommand = vi.fn(() => true);
    document.queryCommandState = vi.fn(() => true);
    document.queryCommandValue = vi.fn(() => 'Arial');
  });

  afterEach(() => {
    if (controller) controller.destroy();
    controller = null;
    document.body.innerHTML = '';
  });

  it('formats a Notch selection through the same controller', () => {
    const notchEditText = document.getElementById('notchEditText');
    const onFormatChange = vi.fn();
    controller = initFormatToolbar({
      promptBox: document.getElementById('promptBox'),
      teleprompterText: document.getElementById('teleprompterText'),
      notchEditText,
      onFormatChange,
    });
    const range = document.createRange();
    range.selectNodeContents(notchEditText);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    document.querySelector('#notchEditToolbar [data-cmd="bold"]').click();

    expect(document.execCommand).toHaveBeenCalledWith('bold');
    expect(onFormatChange).toHaveBeenCalledWith(notchEditText, {});
  });

  it('applies a collapsed Notch font-size change as one shared global setting', () => {
    const promptBox = document.getElementById('promptBox');
    const teleprompterText = document.getElementById('teleprompterText');
    const notchEditText = document.getElementById('notchEditText');
    const onFormatChange = vi.fn();
    controller = initFormatToolbar({
      promptBox,
      teleprompterText,
      notchEditText,
      onFormatChange,
    });
    const range = document.createRange();
    range.selectNodeContents(notchEditText);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const size = document.getElementById('notchEditFontSize');
    size.value = '32';
    size.dispatchEvent(new Event('change', { bubbles: true }));

    [promptBox, teleprompterText, notchEditText].forEach((surface) => {
      expect(surface.style.fontSize).toBe('32px');
    });
    // Commit against the surface being edited (the open notch panel), not the
    // stale main promptBox.
    expect(onFormatChange).toHaveBeenCalledWith(notchEditText, { fontSize: '32' });
  });

  it('applies and synchronizes line height across every teleprompter toolbar and surface', () => {
    const promptBox = document.getElementById('promptBox');
    const teleprompterText = document.getElementById('teleprompterText');
    const notchEditText = document.getElementById('notchEditText');
    const onSettingsChange = vi.fn();
    const onFormatChange = vi.fn();
    controller = initFormatToolbar({
      promptBox,
      teleprompterText,
      notchEditText,
      onSettingsChange,
      onFormatChange,
    });

    [promptBox, teleprompterText, notchEditText].forEach((surface) => {
      expect(surface.style.lineHeight).toBe('1.25');
    });

    const notchLineHeight = document.getElementById('notchEditLineHeight');
    notchLineHeight.value = '1.5';
    notchLineHeight.dispatchEvent(new Event('change', { bubbles: true }));

    [promptBox, teleprompterText, notchEditText].forEach((surface) => {
      expect(surface.style.lineHeight).toBe('1.5');
    });
    document.querySelectorAll('.ft-line-height, #notchEditLineHeight').forEach((select) => {
      expect(select.value).toBe('1.5');
    });
    expect(onSettingsChange).toHaveBeenCalledWith({ lineHeight: '1.5' });
    expect(onFormatChange).toHaveBeenCalledWith(notchEditText, { lineHeight: '1.5' });
  });

  it('commits a global format against the edited Notch content, not the stale main surface', () => {
    const promptBox = document.getElementById('promptBox'); // stays "Prompt text" (stale)
    const teleprompterText = document.getElementById('teleprompterText');
    const notchEditText = document.getElementById('notchEditText');
    const onFormatChange = vi.fn();
    controller = initFormatToolbar({
      promptBox,
      teleprompterText,
      notchEditText,
      onFormatChange,
    });

    // User edits the notch editor; the hidden main surfaces are intentionally
    // left stale (they are re-synced later, not per keystroke).
    notchEditText.innerHTML = 'Freshly edited notch content';

    // Collapsed caret in the notch editor → global (no-selection) format path.
    const range = document.createRange();
    range.selectNodeContents(notchEditText);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    document.querySelector('#notchEditToolbar [data-cmd="bold"]').click();

    // Must commit the notch editor (fresh content), not promptBox (old content).
    expect(onFormatChange).toHaveBeenCalledWith(notchEditText, { bold: true });
  });

  it('turns off a saved global underline even when editor text is selected', () => {
    const promptBox = document.getElementById('promptBox');
    const teleprompterText = document.getElementById('teleprompterText');
    const notchEditText = document.getElementById('notchEditText');
    const onSettingsChange = vi.fn();
    const onFormatChange = vi.fn();
    controller = initFormatToolbar({
      promptBox,
      teleprompterText,
      notchEditText,
      initialUnderline: true,
      onSettingsChange,
      onFormatChange,
    });

    const range = document.createRange();
    range.selectNodeContents(notchEditText);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const underlineButton = document.querySelector('#notchEditToolbar [data-cmd="underline"]');
    expect(underlineButton.classList.contains('active')).toBe(true);
    underlineButton.click();

    [promptBox, teleprompterText, notchEditText].forEach((surface) => {
      expect(surface.style.textDecoration).toBe('');
    });
    expect(underlineButton.classList.contains('active')).toBe(false);
    expect(document.execCommand).not.toHaveBeenCalledWith('underline');
    expect(onSettingsChange).toHaveBeenCalledWith({ underline: false });
    expect(onFormatChange).toHaveBeenCalledWith(notchEditText, { underline: false });
  });

  it('sets global text color to white when setGlobalColor is called', () => {
    const promptBox = document.getElementById('promptBox');
    const teleprompterText = document.getElementById('teleprompterText');
    const notchEditText = document.getElementById('notchEditText');
    const onFormatChange = vi.fn();
    controller = initFormatToolbar({
      promptBox,
      teleprompterText,
      notchEditText,
      onFormatChange,
    });

    controller.setGlobalColor('#ffffff');

    [promptBox, teleprompterText, notchEditText].forEach((surface) => {
      expect(surface.style.color).toBe('rgb(255, 255, 255)');
    });
    // With the notch panel active, the commit source resolves to the notch
    // editor (the active surface), not the stale main promptBox.
    expect(onFormatChange).toHaveBeenCalledWith(notchEditText, { color: '#ffffff' });
  });

  it('keeps a selected iOS editor range when tapping the color picker', async () => {
    const notchEditText = document.getElementById('notchEditText');
    let pickColor;
    const colorPicker = {
      open: vi.fn((_trigger, options) => { pickColor = options.onPick; }),
    };
    controller = initFormatToolbar({
      promptBox: document.getElementById('promptBox'),
      teleprompterText: document.getElementById('teleprompterText'),
      notchEditText,
      colorPicker,
    });
    const range = document.createRange();
    range.selectNodeContents(notchEditText);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    // iOS Safari commonly clears/moves the live selection when a toolbar
    // control is tapped, before the color picker reports the chosen color.
    selection.removeAllRanges();
    document.getElementById('notchEditColorTrigger').click();
    pickColor('#4598e7');

    expect(document.execCommand).toHaveBeenCalledWith('foreColor', false, '#4598e7');
    expect(notchEditText.style.color).toBe('');
  });
});
