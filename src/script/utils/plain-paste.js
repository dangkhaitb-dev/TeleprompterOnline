// plain-paste.js — force contenteditable prompt surfaces to accept pasted
// content as plain text only. Pasting from Word, a web page, or another rich
// source would otherwise inject arbitrary HTML markup (fonts, colours, tables,
// <img>…) straight into the editor. We keep just the text — including its spaces
// and line breaks — and drop every tag/style.

// Insert the clipboard's plain text at the caret. execCommand('insertText')
// keeps the browser's native undo stack in sync and fires an 'input' event, so
// the existing edit-commit wiring (shared history + notch preview) picks the
// paste up exactly like ordinary typing.
export function handlePlainTextPaste(event) {
  const clipboard = event.clipboardData;
  if (!clipboard) return;
  // Always block the default rich paste; only re-insert the stripped text.
  event.preventDefault();
  const text = clipboard.getData('text/plain');
  if (!text) return;
  document.execCommand('insertText', false, text);
}
