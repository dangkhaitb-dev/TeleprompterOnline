// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePlainTextPaste } from './plain-paste.js';

function makePasteEvent(dataByType) {
  return {
    preventDefault: vi.fn(),
    clipboardData: {
      getData: (type) => dataByType[type] || '',
    },
  };
}

describe('handlePlainTextPaste', () => {
  beforeEach(() => {
    document.execCommand = vi.fn(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks the default paste and inserts only the plain text', () => {
    const event = makePasteEvent({
      'text/plain': 'Hello world',
      'text/html': '<b style="color:red">Hello world</b>',
    });

    handlePlainTextPaste(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.execCommand).toHaveBeenCalledWith('insertText', false, 'Hello world');
  });

  it('preserves spaces and line breaks in the pasted text', () => {
    const text = 'Line one\n\nLine  two   with spaces';
    const event = makePasteEvent({ 'text/plain': text });

    handlePlainTextPaste(event);

    expect(document.execCommand).toHaveBeenCalledWith('insertText', false, text);
  });

  it('never injects the HTML flavour of the clipboard', () => {
    const event = makePasteEvent({
      'text/plain': 'plain',
      'text/html': '<img src=x onerror=alert(1)>',
    });

    handlePlainTextPaste(event);

    const insertedValues = document.execCommand.mock.calls.map((call) => call[2]);
    expect(insertedValues).toEqual(['plain']);
    expect(insertedValues.join('')).not.toContain('<img');
  });

  it('blocks the paste but inserts nothing when there is no text (e.g. image-only)', () => {
    const event = makePasteEvent({ 'text/html': '<img src=x>' });

    handlePlainTextPaste(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it('does nothing when the event has no clipboardData', () => {
    const event = { preventDefault: vi.fn(), clipboardData: null };

    handlePlainTextPaste(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(document.execCommand).not.toHaveBeenCalled();
  });
});
