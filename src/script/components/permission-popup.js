// permission-popup.js — guidance dialog shown when camera/mic access is BLOCKED.
// A blocked permission can't be re-prompted from JS (browser security), so this
// only *shows how* to re-enable it: a platform illustration with a red box on
// the exact control to tap, plus a couple of short steps. Mirrors confirm-popup
// (focus-trap, Esc/backdrop = close, one-shot self-removal). Pages import
// styles/components/permission-popup.css. Returns Promise<'dismissed'>.

import { illustrationsFor } from './permission-illustrations.js';

// Map the detected platform to the copy.steps.* bucket for that platform.
export function stepsKeyFor({ os, browser } = {}) {
  if (os === 'ios') return browser === 'safari' ? 'iosSafari' : 'iosOther';
  if (os === 'android') return 'android';
  if (browser === 'firefox') return 'desktopFirefox';
  if (browser === 'safari') return 'desktopSafari';
  if (browser === 'edge') return 'desktopEdge';
  if (browser === 'chrome') return 'desktopChromium';
  return 'fallback';
}

function titleFor(blocked, copy) {
  const wantsCam = blocked.includes('camera');
  const wantsMic = blocked.includes('mic');
  if (wantsCam && wantsMic) return copy.bothTitle || 'Camera & microphone are blocked';
  if (wantsMic) return copy.micTitle || 'Microphone is blocked';
  return copy.cameraTitle || 'Camera is blocked';
}

export function showPermissionPopup({
  blocked = ['camera'],
  platform = {},
  copy = {},
  container = document.body,
} = {}) {
  return new Promise((resolve) => {
    const key = stepsKeyFor(platform);
    const steps = (copy.steps && copy.steps[key]) || [];
    const figures = illustrationsFor(key);

    const overlay = document.createElement('div');
    overlay.className = 'permission-overlay';
    overlay.innerHTML = `
      <div class="permission-box" role="dialog" aria-modal="true" aria-labelledby="permission-title">
        <button class="permission-x" type="button" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
        <h2 class="permission-title" id="permission-title"></h2>
        <ol class="permission-steps"></ol>
        <button class="permission-btn permission-close" type="button"></button>
      </div>`;

    overlay.querySelector('.permission-title').textContent = titleFor(blocked, copy);

    const list = overlay.querySelector('.permission-steps');
    steps.forEach((text, i) => {
      const li = document.createElement('li');
      li.className = 'permission-step';
      const head = document.createElement('div');
      head.className = 'permission-step-head';
      head.textContent = text; // textContent — never inject copy as HTML
      li.appendChild(head);
      const figureHtml = figures[i];
      if (figureHtml) {
        const fig = document.createElement('div');
        fig.className = 'permission-step-fig';
        fig.setAttribute('aria-hidden', 'true');
        fig.innerHTML = figureHtml; // static, developer-authored markup (no user data)
        li.appendChild(fig);
      }
      list.appendChild(li);
    });

    const closeBtn = overlay.querySelector('.permission-close');
    closeBtn.textContent = copy.close || 'Got it';

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve('dismissed');
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish();
      }
      if (event.key === 'Tab') {
        // Single focusable — keep focus on it.
        event.preventDefault();
        closeBtn.focus();
      }
    };

    closeBtn.addEventListener('click', finish);
    overlay.querySelector('.permission-x').addEventListener('click', finish);
    overlay.addEventListener('pointerdown', (event) => {
      if (event.target === overlay) finish();
    });
    document.addEventListener('keydown', onKey, true);

    container.appendChild(overlay);
    closeBtn.focus();
  });
}
