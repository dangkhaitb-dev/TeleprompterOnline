// drag-drop.js — window-level file drag-and-drop with a depth counter so the
// overlay toggles correctly across nested elements (dragenter/leave fire per
// child). Returns a cleanup function that removes every listener.

export function initFileDragDrop({ onFile, onToggle, isSuppressed } = {}) {
  let depth = 0;

  const setActive = (active) => {
    if (typeof onToggle === 'function') onToggle(active);
  };

  // Only react to real OS file drags — NOT to internal element drags (e.g.
  // dragging a card). The 'Files' type check catches most cases, but some
  // browsers still expose it during an in-page drag; the host can pass
  // isSuppressed() (e.g. "an internal drag is in progress") to force-ignore
  // those so the drop overlay never fights with the card drag.
  const isFileDrag = (e) => {
    if (typeof isSuppressed === 'function' && isSuppressed()) return false;
    const types = e.dataTransfer && e.dataTransfer.types;
    return !!types && Array.prototype.indexOf.call(types, 'Files') !== -1;
  };

  const onDragEnter = (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    depth += 1;
    if (depth === 1) setActive(true);
  };
  const onDragOver = (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
  };
  const onDragLeave = (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    depth = Math.max(0, depth - 1);
    if (depth === 0) setActive(false);
  };
  const onDrop = (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    depth = 0;
    setActive(false);
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file && typeof onFile === 'function') onFile(file);
  };

  window.addEventListener('dragenter', onDragEnter);
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('dragleave', onDragLeave);
  window.addEventListener('drop', onDrop);

  return () => {
    window.removeEventListener('dragenter', onDragEnter);
    window.removeEventListener('dragover', onDragOver);
    window.removeEventListener('dragleave', onDragLeave);
    window.removeEventListener('drop', onDrop);
  };
}
