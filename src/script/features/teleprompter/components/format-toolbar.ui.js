// format-toolbar.ui.js — desktop pill + mobile bar text formatting (B/I/U, font
// size, color, alignment). Ported from recorder.js wireFormatToolbars.
// execCommand is deprecated but kept for parity with the demo; it is isolated
// here so a Selection/Range formatter can replace it later. No HTML injection —
// only execCommand on the contenteditable prompt surfaces.

const DEFAULT_COLOR = '#ef4d62';

export function initFormatToolbar({
  root = document,
  promptBox,
  teleprompterText,
  notchEditText,
  colorPicker,
  initialAlign = 'justify',
  initialFontSize = '',
  initialLineHeight = '1.25',
  initialColor = '',
  initialBold = false,
  initialItalic = false,
  initialUnderline = false,
  onAlignChange,
  onSettingsChange,
  onFormatChange,
} = {}) {
  const toolbars = Array.from(root.querySelectorAll('.format-toolbar, #notchEditToolbar'));
  if (!toolbars.length || !promptBox) return { destroy() {} };

  const colorTriggers = Array.from(root.querySelectorAll('.ft-color-picker-btn, #notchEditColorTrigger'));
  const colorBars = Array.from(root.querySelectorAll('.ft-color-bar, #notchEditColorBar'));
  const colorApplyBtns = Array.from(root.querySelectorAll('.ft-color, #notchEditColorApplyBtn'));
  const fontSizeControls = Array.from(root.querySelectorAll('.format-toolbar .ft-font-size, #notchEditFontSize'));
  const fontSizeControlGroups = Array.from(root.querySelectorAll('.font-size-control'));
  const fontSizeGroupsByControl = new Map(fontSizeControls.map((control) => [control, control.closest('.font-size-control')]));
  const fontSizeMenus = new Map(fontSizeControlGroups.map((group) => [group, group.querySelector('.font-size-menu')]));
  const lineHeightSelects = Array.from(root.querySelectorAll('.format-toolbar .ft-line-height, #notchEditLineHeight'));
  const alignButtons = Array.from(root.querySelectorAll('.format-toolbar .ft-align, #notchEditToolbar .notch-edit-align'));

  let colorHex = initialColor || DEFAULT_COLOR;
  let savedRange = null;
  const cleanups = [];
  const on = (el, type, fn, opts) => {
    if (!el) return;
    el.addEventListener(type, fn, opts);
    cleanups.push(() => el.removeEventListener(type, fn, opts));
  };

  const surfaces = [promptBox, teleprompterText, notchEditText].filter(Boolean);

  function setSelectValue(select, value) {
    const fallback = Array.from(select.options).find((option) => option.hasAttribute('selected')) || select.options[0];
    select.value = value || (fallback ? fallback.value : '');
  }

  function normalizeFontSize(value) {
    const size = Number.parseFloat(value);
    return Number.isFinite(size) && size > 0 ? String(size) : '';
  }

  function setFontSizeValue(control, value) {
    const size = normalizeFontSize(value) || control.defaultValue || '';
    control.value = size;
    const group = fontSizeGroupsByControl.get(control) || control.closest('.font-size-control');
    const label = group?.querySelector('.font-size-value');
    if (label) label.textContent = size ? `${size}px` : '';
  }

  function closeFontSizeMenus(except = null) {
    fontSizeControlGroups.forEach((group) => {
      if (group === except) return;
      const menu = fontSizeMenus.get(group);
      const toggle = group.querySelector('.font-size-trigger');
      if (menu) {
        menu.hidden = true;
        if (menu.parentElement !== group) group.appendChild(menu);
      }
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    });
  }

  function positionFontSizeMenu(group, menu) {
    const { left, top, bottom } = group.getBoundingClientRect();
    const menuHeight = Math.min(menu.scrollHeight, window.innerHeight - 16);
    const leftPosition = Math.min(Math.max(8, left), window.innerWidth - menu.offsetWidth - 8);
    const hasRoomBelow = window.innerHeight - bottom - 8 >= Math.min(menuHeight, 180);
    const topPosition = hasRoomBelow
      ? bottom + 8
      : Math.max(8, top - menuHeight - 8);

    menu.style.left = `${leftPosition}px`;
    menu.style.top = `${topPosition}px`;
  }

  function toggleFontSizeMenu(group) {
    const menu = fontSizeMenus.get(group);
    const toggle = group.querySelector('.font-size-trigger');
    const input = group.querySelector('.ft-font-size, #notchEditFontSize');
    if (!menu || !toggle || !input) return;
    const isOpen = menu.hidden;
    closeFontSizeMenus(group);
    if (isOpen) {
      menu.classList.toggle('font-size-menu--notch', group.classList.contains('notch-font-size-control'));
      menu.classList.toggle('font-size-menu--dark', Boolean(group.closest('.panel:not(.theme-light)')));
      menu.classList.toggle('font-size-menu--mobile', group.closest('#mobileFormatToolbar') !== null);
      document.body.appendChild(menu);
    }
    menu.hidden = !isOpen;
    if (!isOpen) group.appendChild(menu);
    if (isOpen) positionFontSizeMenu(group, menu);
    toggle.setAttribute('aria-expanded', String(isOpen));
  }

  function applySettings(settings = {}) {
    const fontSize = settings.fontSize || '';
    const lineHeight = settings.lineHeight || '1.25';
    const color = settings.color || '';
    surfaces.forEach((surface) => {
      surface.style.fontSize = fontSize ? `${fontSize}px` : '';
      surface.style.lineHeight = lineHeight;
      surface.style.color = color;
      surface.style.fontWeight = settings.bold ? 'bold' : '';
      surface.style.fontStyle = settings.italic ? 'italic' : '';
      surface.style.textDecoration = settings.underline ? 'underline' : '';
    });
    fontSizeControls.forEach((control) => setFontSizeValue(control, fontSize));
    lineHeightSelects.forEach((select) => setSelectValue(select, lineHeight));
    colorHex = color || DEFAULT_COLOR;
    colorBars.forEach((bar) => { bar.style.background = colorHex; });
    ['bold', 'italic', 'underline'].forEach((command) => {
      root.querySelectorAll(`.format-toolbar [data-cmd="${command}"], #notchEditToolbar [data-cmd="${command}"]`).forEach((button) => {
        button.classList.toggle('active', Boolean(settings[command]));
      });
    });
    applyTextAlignment(settings.align || 'left');
  }

  applySettings({
    align: initialAlign,
    fontSize: initialFontSize,
    lineHeight: initialLineHeight,
    color: initialColor,
    bold: initialBold,
    italic: initialItalic,
    underline: initialUnderline,
  });

  function getActiveSurface() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const node = sel.getRangeAt(0).commonAncestorContainer;
      const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      if (el) {
        if (notchEditText && notchEditText.contains(el)) return notchEditText;
        if (teleprompterText && teleprompterText.contains(el)) return teleprompterText;
        if (promptBox && promptBox.contains(el)) return promptBox;
      }
    }
    const app = root.querySelector('#app');
    if (app && app.classList.contains('notch-on') && notchEditText) {
      const panel = root.querySelector('#notchEditPanel');
      if (panel && panel.classList.contains('show')) return notchEditText;
    }
    if (app && app.classList.contains('cam-on') && teleprompterText) {
      return teleprompterText;
    }
    return promptBox;
  }

  function getPromptSelectionRange() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!el) return null;
    const isInsidePrompt = promptBox && promptBox.contains(el);
    const isInsideTeleprompter = teleprompterText && teleprompterText.contains(el);
    const isInsideNotch = notchEditText && notchEditText.contains(el);
    if (!isInsidePrompt && !isInsideTeleprompter && !isInsideNotch) return null;
    return range;
  }

  function refreshBiuState() {
    ['bold', 'italic', 'underline'].forEach((cmd) => {
      let active = false;
      try { active = document.queryCommandState(cmd); } catch { /* noop */ }
      root.querySelectorAll(`.format-toolbar [data-cmd="${cmd}"], #notchEditToolbar [data-cmd="${cmd}"]`).forEach((btn) => {
        btn.classList.toggle('active', active);
      });
    });
    refreshFontSizeSelect();
  }

  function refreshFontSizeSelect() {
    const range = getPromptSelectionRange();
    if (!range) return;

    let node = range.commonAncestorContainer;
    if (node.nodeType !== Node.ELEMENT_NODE) {
      node = node.parentElement;
    }

    const surface = getActiveSurface();
    let detectedSize = '';

    let current = node;
    while (current && surface && surface.contains(current) && current !== surface) {
      if (current.style && current.style.fontSize) {
        detectedSize = current.style.fontSize.replace('px', '').trim();
        break;
      }
      current = current.parentElement;
    }

    if (!detectedSize && node && surface && surface.contains(node)) {
      const computedSize = window.getComputedStyle(node).fontSize;
      if (computedSize) {
        detectedSize = Math.round(parseFloat(computedSize)).toString();
      }
    }

    fontSizeControls.forEach((control) => {
      if (detectedSize) {
        setFontSizeValue(control, detectedSize);
      }
    });
  }

  function syncSelection() {
    const range = getPromptSelectionRange();
    if (!range) return;
    savedRange = range.cloneRange();
    refreshBiuState();
  }

  function restoreSelection() {
    if (!savedRange) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }

  function selectAllWhenSelectionIsCollapsed(surface) {
    const sel = window.getSelection();
    if (!sel) return null;

    const currentRange = sel.rangeCount ? sel.getRangeAt(0) : null;
    const node = currentRange && currentRange.commonAncestorContainer;
    const element = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    const isInsideSurface = Boolean(element && surface.contains(element));

    if (isInsideSurface && !currentRange.collapsed) return null;

    const caretRange = isInsideSurface ? currentRange.cloneRange() : null;
    const wholeSurface = document.createRange();
    wholeSurface.selectNodeContents(surface);
    sel.removeAllRanges();
    sel.addRange(wholeSurface);
    return caretRange || false;
  }

  function restoreCaretAfterEditAll(surface, caretRange) {
    if (caretRange === null) return;
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    try {
      if (caretRange) sel.addRange(caretRange);
      else {
        const endRange = document.createRange();
        endRange.selectNodeContents(surface);
        endRange.collapse(false);
        sel.addRange(endRange);
      }
    } catch {
      const endRange = document.createRange();
      endRange.selectNodeContents(surface);
      endRange.collapse(false);
      sel.addRange(endRange);
    }
  }

  function applyFormat(run) {
    const surface = getActiveSurface();
    if (surface) surface.focus();
    restoreSelection();
    const caretRange = selectAllWhenSelectionIsCollapsed(surface);
    try { document.execCommand('styleWithCSS', false, true); } catch { /* noop */ }
    run();
    restoreCaretAfterEditAll(surface, caretRange);
    const sel = window.getSelection();
    if (sel && sel.rangeCount) savedRange = sel.getRangeAt(0).cloneRange();
    refreshBiuState();
    if (typeof onFormatChange === 'function') onFormatChange(surface, {});
  }

  function isSelectionActive() {
    const range = getPromptSelectionRange();
    if (range && !range.collapsed) return true;

    // Mobile Safari moves the live Selection onto the tapped toolbar control
    // before its click handler runs. Keep using the last editor range so color
    // picking (whose callback runs even later) still formats the selected text.
    return Boolean(savedRange && !savedRange.collapsed);
  }

  function clearStyleFromDescendants(element, styleProp) {
    if (!element) return;
    element.querySelectorAll('*').forEach((child) => {
      if (child.style) {
        child.style[styleProp] = '';
        if (!child.getAttribute('style')) {
          child.removeAttribute('style');
        }
      }
    });
  }

  function removeTags(container, tagNames) {
    if (!container) return;
    tagNames.forEach((tagName) => {
      container.querySelectorAll(tagName).forEach((el) => {
        const parent = el.parentNode;
        while (el.firstChild) {
          parent.insertBefore(el.firstChild, el);
        }
        parent.removeChild(el);
      });
    });
  }

  function cleanEmptySpans(container) {
    if (!container) return;
    container.querySelectorAll('span').forEach((span) => {
      if (!span.style.cssText && !span.className && !span.id) {
        const parent = span.parentNode;
        while (span.firstChild) {
          parent.insertBefore(span.firstChild, span);
        }
        parent.removeChild(span);
      }
    });
  }

  function applyGlobalFormat(cmd, value) {
    const patch = {};

    if (cmd === 'bold') {
      const isBold = promptBox.style.fontWeight === 'bold';
      const nextBold = !isBold;
      surfaces.forEach((s) => {
        s.style.fontWeight = nextBold ? 'bold' : '';
        clearStyleFromDescendants(s, 'fontWeight');
        removeTags(s, ['b', 'strong']);
        cleanEmptySpans(s);
      });
      patch.bold = nextBold;
      root.querySelectorAll('.format-toolbar [data-cmd="bold"], #notchEditToolbar [data-cmd="bold"]').forEach((btn) => {
        btn.classList.toggle('active', nextBold);
      });
    } else if (cmd === 'italic') {
      const isItalic = promptBox.style.fontStyle === 'italic';
      const nextItalic = !isItalic;
      surfaces.forEach((s) => {
        s.style.fontStyle = nextItalic ? 'italic' : '';
        clearStyleFromDescendants(s, 'fontStyle');
        removeTags(s, ['i', 'em']);
        cleanEmptySpans(s);
      });
      patch.italic = nextItalic;
      root.querySelectorAll('.format-toolbar [data-cmd="italic"], #notchEditToolbar [data-cmd="italic"]').forEach((btn) => {
        btn.classList.toggle('active', nextItalic);
      });
    } else if (cmd === 'underline') {
      const isUnderline = promptBox.style.textDecoration === 'underline';
      const nextUnderline = !isUnderline;
      surfaces.forEach((s) => {
        s.style.textDecoration = nextUnderline ? 'underline' : '';
        clearStyleFromDescendants(s, 'textDecoration');
        removeTags(s, ['u']);
        cleanEmptySpans(s);
      });
      patch.underline = nextUnderline;
      root.querySelectorAll('.format-toolbar [data-cmd="underline"], #notchEditToolbar [data-cmd="underline"]').forEach((btn) => {
        btn.classList.toggle('active', nextUnderline);
      });
    } else if (cmd === 'fontSize') {
      surfaces.forEach((s) => {
        s.style.fontSize = value ? `${value}px` : '';
        clearStyleFromDescendants(s, 'fontSize');
        s.querySelectorAll('font[size]').forEach((f) => {
          f.removeAttribute('size');
          if (!f.attributes.length) {
            const p = f.parentNode;
            while (f.firstChild) p.insertBefore(f.firstChild, f);
            p.removeChild(f);
          }
        });
        cleanEmptySpans(s);
      });
      patch.fontSize = value;
      fontSizeControls.forEach((control) => { setFontSizeValue(control, value); });
    } else if (cmd === 'lineHeight') {
      surfaces.forEach((s) => {
        s.style.lineHeight = value || '1.25';
        clearStyleFromDescendants(s, 'lineHeight');
      });
      patch.lineHeight = value || '1.25';
      lineHeightSelects.forEach((select) => { select.value = patch.lineHeight; });
    } else if (cmd === 'foreColor') {
      colorHex = value;
      colorBars.forEach((bar) => { bar.style.background = value; });
      surfaces.forEach((s) => {
        s.style.color = value;
        clearStyleFromDescendants(s, 'color');
        s.querySelectorAll('font[color]').forEach((f) => {
          f.removeAttribute('color');
          if (!f.attributes.length) {
            const p = f.parentNode;
            while (f.firstChild) p.insertBefore(f.firstChild, f);
            p.removeChild(f);
          }
        });
        cleanEmptySpans(s);
      });
      patch.color = value;
    }

    if (typeof onSettingsChange === 'function') {
      onSettingsChange(patch);
    }
    // Commit against the surface actually being edited, not a hardcoded
    // promptBox. While the Notch edit panel is open (or in camera mode) the
    // main surfaces are stale "dirty" mirrors — reading html from promptBox
    // here would clobber the live edit with old content.
    if (typeof onFormatChange === 'function') onFormatChange(getActiveSurface(), patch);
  }

  toolbars.forEach((toolbar) => {
    on(toolbar, 'mousedown', (e) => {
      if (e.target.closest('select, input')) return;
      e.preventDefault(); // keep the prompt-box selection
    });
    toolbar.querySelectorAll('button[data-cmd]').forEach((btn) => {
      on(btn, 'click', () => {
        // A selection cannot cancel text-decoration inherited from the editor
        // surface itself: wrapping the selection with "text-decoration: none"
        // still leaves the ancestor underline painted by CSS. Treat this case
        // as switching off the saved global underline so the control can
        // actually be toggled off (and all mirrored surfaces stay in sync).
        const hasGlobalUnderline = btn.dataset.cmd === 'underline'
          && promptBox.style.textDecoration.includes('underline');
        if (hasGlobalUnderline) {
          applyGlobalFormat('underline');
          return;
        }
        if (isSelectionActive()) {
          applyFormat(() => document.execCommand(btn.dataset.cmd));
        } else {
          applyGlobalFormat(btn.dataset.cmd);
        }
      });
    });
  });

  colorApplyBtns.forEach((btn) => {
    on(btn, 'click', () => {
      if (isSelectionActive()) {
        applyFormat(() => document.execCommand('foreColor', false, colorHex));
      } else {
        applyGlobalFormat('foreColor', colorHex);
      }
    });
  });

  colorTriggers.forEach((trigger) => {
    on(trigger, 'click', () => {
      if (!colorPicker) return;
      colorPicker.open(trigger, {
        hex: colorHex,
        dark: Boolean(trigger.closest('#notchEditToolbar')),
        onPick: (hex) => {
          colorHex = hex;
          colorBars.forEach((bar) => { bar.style.background = hex; });
          if (isSelectionActive()) {
            applyFormat(() => document.execCommand('foreColor', false, hex));
          } else {
            applyGlobalFormat('foreColor', hex);
          }
        },
      });
    });
  });

  fontSizeControls.forEach((control) => {
    on(control, 'change', () => {
      const px = normalizeFontSize(control.value);
      if (!px) return;
      fontSizeControls.forEach((otherControl) => { setFontSizeValue(otherControl, px); });
      if (isSelectionActive()) {
        applyFormat(() => {
          // execCommand fontSize only takes 1-7: use size 7 as a marker then swap to px.
          try { document.execCommand('styleWithCSS', false, false); } catch { /* noop */ }
          document.execCommand('fontSize', false, '7');
          const spans = [];
          const surface = getActiveSurface();
          surface.querySelectorAll('font[size="7"]').forEach((font) => {
            const span = document.createElement('span');
            span.style.fontSize = `${px}px`;
            while (font.firstChild) span.appendChild(font.firstChild);
            font.replaceWith(span);
            spans.push(span);
          });
          if (spans.length) {
            const range = document.createRange();
            range.setStartBefore(spans[0]);
            range.setEndAfter(spans[spans.length - 1]);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          }
        });
      } else {
        applyGlobalFormat('fontSize', px);
      }
    });
    on(control, 'keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      control.dispatchEvent(new Event('change', { bubbles: true }));
      closeFontSizeMenus();
      control.blur();
    });
  });

  fontSizeControlGroups.forEach((group) => {
    const toggle = group.querySelector('.font-size-trigger');
    const menu = fontSizeMenus.get(group);
    on(toggle, 'click', () => toggleFontSizeMenu(group));
    on(menu, 'click', (event) => {
      const option = event.target.closest('[data-font-size]');
      if (!option) return;
      const input = menu.querySelector('.ft-font-size, #notchEditFontSize');
      if (!input) return;
      input.value = option.dataset.fontSize;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      closeFontSizeMenus();
      toggle.focus();
    });
  });

  on(root, 'click', (event) => {
    if (!event.target.closest('.font-size-control, .font-size-menu')) closeFontSizeMenus();
  });
  on(root, 'keydown', (event) => {
    if (event.key === 'Escape') closeFontSizeMenus();
  });

  // Line height is a shared reading-layout setting, so it always applies to
  // the complete script across the default, camera, mobile and Notch surfaces.
  lineHeightSelects.forEach((select) => {
    on(select, 'change', () => {
      applyGlobalFormat('lineHeight', select.value || '1.25');
    });
  });

  function applyTextAlignment(alignment) {
    surfaces.forEach((surface) => { surface.style.textAlign = alignment; });
    alignButtons.forEach((btn) => {
      const active = btn.dataset.align === alignment;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  alignButtons.forEach((btn) => {
    on(btn, 'click', () => {
      applyTextAlignment(btn.dataset.align);
      if (typeof onAlignChange === 'function') onAlignChange(btn.dataset.align);
    });
  });

  // Restore this script's saved alignment (no callback on the initial apply).
  applyTextAlignment(initialAlign);

  // selectionchange fires per caret move (every keystroke, continuously while
  // selecting with the mouse) — queue at most one sync per frame.
  let selectionSyncQueued = false;
  const onSelectionChange = () => {
    if (selectionSyncQueued) return;
    selectionSyncQueued = true;
    requestAnimationFrame(() => {
      selectionSyncQueued = false;
      syncSelection();
    });
  };
  document.addEventListener('selectionchange', onSelectionChange);
  cleanups.push(() => document.removeEventListener('selectionchange', onSelectionChange));

  return {
    applySettings,
    setGlobalColor(hex) {
      applyGlobalFormat('foreColor', hex);
    },
    destroy() {
      cleanups.forEach((fn) => fn());
    },
  };
}
