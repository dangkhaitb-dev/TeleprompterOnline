// settings-theme.ui.js — Settings popup switches (Countdown, Fullscreen synced
// to the real browser state) + page-theme radios + panel theme button +
// layout-guides toggle. Ported from recorder.js settings/theme sections.
//
// Persistence is per-script: this component is stateless about storage — it
// takes `initial` values to restore from and reports persistent changes via
// `onChange` (the teleprompter owns saving into the workspace's settings).
// Layout guides are intentionally session-only and always start hidden.

import {
  enterFullscreen,
  exitFullscreen,
  isFullscreen,
  onFullscreenChange,
} from '../../../utils/fullscreen.js';
import { scopedId } from '../../../utils/scoped-query.js';

export function initSettingsTheme({
  root = document,
  app,
  prompterPanel,
  onFullscreenBlocked,
  initial = {},
  onChange,
  initialStorageWarning = true,
  onStorageWarningChange,
} = {}) {
  const $ = scopedId(root);
  const cleanups = [];
  const on = (el, type, fn) => {
    if (!el) return;
    el.addEventListener(type, fn);
    cleanups.push(() => el.removeEventListener(type, fn));
  };
  const emit = (patch) => { if (typeof onChange === 'function') onChange(patch); };

  // ---- Countdown setting ----------------------------------------------------
  const settingsState = {
    countdown: initial.countdown !== false,
    notchFullscreen: initial.notchFullscreen !== false,
  };
  const toggleCountdown = $('toggleCountdown');
  if (toggleCountdown) {
    toggleCountdown.checked = settingsState.countdown;
    on(toggleCountdown, 'change', () => {
      settingsState.countdown = toggleCountdown.checked;
      emit({ countdown: settingsState.countdown });
    });
  }

  // ---- Notch fullscreen settings ------------------------------------------
  const toggleNotchFullscreen = $('toggleNotchFullscreen');
  if (toggleNotchFullscreen) toggleNotchFullscreen.checked = settingsState.notchFullscreen;

  on(toggleNotchFullscreen, 'change', () => {
    settingsState.notchFullscreen = toggleNotchFullscreen.checked;
    emit({ notchFullscreen: settingsState.notchFullscreen });
  });

  // ---- Storage warning toggle (global pref, not per-script) -----------------
  let storageWarningEnabled = initialStorageWarning;
  const toggleStorageWarning = $('toggleStorageWarning');
  if (toggleStorageWarning) {
    toggleStorageWarning.checked = storageWarningEnabled;
    on(toggleStorageWarning, 'change', () => {
      storageWarningEnabled = toggleStorageWarning.checked;
      if (typeof onStorageWarningChange === 'function') {
        onStorageWarningChange(storageWarningEnabled);
      }
    });
  }

  // ---- Fullscreen toggle (reflects real state) -----------------------------
  const toggleFullscreen = $('toggleFullscreen');
  if (toggleFullscreen) {
    const sync = () => { toggleFullscreen.checked = isFullscreen(); };
    on(toggleFullscreen, 'change', () => {
      if (toggleFullscreen.checked) {
        enterFullscreen().catch(() => {
          if (typeof onFullscreenBlocked === 'function') onFullscreenBlocked();
        });
      } else {
        exitFullscreen();
      }
    });
    cleanups.push(onFullscreenChange(sync));
    sync();
  }

  // ---- Page theme radios (light/dark) --------------------------------------
  // Theme is applied on <html> on purpose: it stays global even when the
  // teleprompter is mounted inside an overlay root.
  const docEl = document.documentElement;
  const lightBtn = $('themeLightBtn');
  const darkBtn = $('themeDarkBtn');

  function reflectThemeButtons(theme) {
    const isLight = theme === 'light';
    if (lightBtn) {
      lightBtn.classList.toggle('active', isLight);
      lightBtn.setAttribute('aria-checked', String(isLight));
    }
    if (darkBtn) {
      darkBtn.classList.toggle('active', !isLight);
      darkBtn.setAttribute('aria-checked', String(!isLight));
    }
  }

  function applyPageTheme(next) {
    docEl.classList.add('theme-instant');
    docEl.dataset.theme = next;
    void docEl.offsetWidth; // force the instant swap
    docEl.classList.remove('theme-instant');
    reflectThemeButtons(next);
  }

  function setPageTheme(next) {
    applyPageTheme(next);
    // Map page theme to the corresponding panel theme: light -> light-60, dark -> dark-60
    const panelNext = next === 'light' ? 'light-60' : 'dark-60';
    applyPanelTheme(panelNext);
    emit({ pageTheme: next, panelTheme: panelNext });
  }

  // ---- Panel background color themes (independent of page theme) ------------
  const PANEL_THEMES = ['dark-60', 'light-60', 'light-30', 'dark-30'];

  function applyPanelTheme(theme) {
    if (!prompterPanel) return;
    PANEL_THEMES.forEach((t) => {
      prompterPanel.classList.remove(`panel-theme-${t}`);
    });
    const normalized = PANEL_THEMES.includes(theme) ? theme : 'dark-60';
    prompterPanel.classList.add(`panel-theme-${normalized}`);

    // If panel theme starts with 'light-', apply 'theme-light' for dark text/elements
    const isLight = normalized.startsWith('light-');
    prompterPanel.classList.toggle('theme-light', isLight);
  }

  // Restore this script's saved page theme (default dark for the studio).
  const startTheme = initial.pageTheme === 'light' ? 'light' : 'dark';
  applyPageTheme(startTheme);
  on(lightBtn, 'click', () => setPageTheme('light'));
  on(darkBtn, 'click', () => setPageTheme('dark'));

  // Restore this script's saved panel background theme (fallback to default based on page theme).
  const startPanelTheme = initial.panelTheme || (startTheme === 'light' ? 'light-60' : 'dark-60');
  applyPanelTheme(startPanelTheme);

  const barThemeBtn = $('barThemeBtn');
  on(barThemeBtn, 'click', () => {
    if (!prompterPanel) return;
    
    // Determine current theme based on active panel-theme class
    let currentTheme = 'dark-60';
    for (const t of PANEL_THEMES) {
      if (prompterPanel.classList.contains(`panel-theme-${t}`)) {
        currentTheme = t;
        break;
      }
    }
    
    const currentIndex = PANEL_THEMES.indexOf(currentTheme);
    const nextIndex = (currentIndex + 1) % PANEL_THEMES.length;
    const nextTheme = PANEL_THEMES[nextIndex];
    
    applyPanelTheme(nextTheme);
    emit({ panelTheme: nextTheme });
  });

  // ---- Layout-guides toggle (mobile) ---------------------------------------
  const layoutControl = $('layoutControl');
  const initialLayoutGuides = false;
  if (layoutControl) {
    layoutControl.setAttribute('aria-pressed', String(initialLayoutGuides));
    layoutControl.classList.toggle('selected', initialLayoutGuides);
  }
  if (app) app.classList.toggle('layout-guides-on', initialLayoutGuides);
  on(layoutControl, 'click', () => {
    const active = layoutControl.getAttribute('aria-pressed') !== 'true';
    layoutControl.setAttribute('aria-pressed', String(active));
    layoutControl.classList.toggle('selected', active);
    if (app) app.classList.toggle('layout-guides-on', active);
  });

  return {
    wantsCountdown: () => settingsState.countdown,
    wantsNotchFullscreen: () => settingsState.notchFullscreen,
    wantsStorageWarning: () => storageWarningEnabled,
    destroy() { cleanups.forEach((fn) => fn()); },
  };
}
