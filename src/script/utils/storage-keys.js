// storage-keys.js — single source of truth for localStorage/sessionStorage keys.
// Declare every key here; access it through a wrapper in utils/ (ESLint forbids
// touching localStorage directly in feature code).

export const LS_AUTH_STATE = 'solprompter:auth-state';

// Saved script projects (the Workspaces library). Array of Workspace objects.
export const LS_WORKSPACES = 'solprompter:workspaces';

// Folders for organizing workspaces (the Workspaces library). Array of Folder
// objects { id, name, parentId } — parentId null = root. Nesting supported.
export const LS_FOLDERS = 'solprompter:folders';

// One-shot flag: has the Workspaces library been seeded with its default empty
// folder yet? Prevents re-creating it after the user deletes it.
export const LS_WS_SEEDED = 'solprompter:ws-seeded';

// User-chosen max local storage budget for recordings, in bytes. Default 2 GB;
// hard-capped at the client's real per-origin quota (the device's free disk).
export const LS_WS_STORAGE_LIMIT = 'solprompter:ws-storage-limit';

// Master switch: whether new recordings are saved to this device at all.
// Default on; when off, the teleprompter records but never persists the take.
export const LS_WS_SAVE_RECORDINGS = 'solprompter:ws-save-recordings';

// Whether the Studio should warn before recording into low local storage.
export const LS_STORAGE_WARNING = 'sol:storage-warning';

// Persisted UI theme preference for the teleprompter/editor ('light' | 'dark').
export const LS_THEME = 'solprompter:theme';

// Teleprompter studio preferences.
// Per-script settings live on the Workspace (see teleprompter.model
// normalizeSettings). This ONE global key holds the last-used studio settings,
// applied to a brand-new script that has none of its own yet.
export const LS_GLOBAL_SETTING_PROMPTER = 'global_setting_promter';
export const LS_TP_COLOR_HISTORY = 'solprompter:tp-color-history'; // recent picker colors
export const LS_TP_NOTCH_SIZE = 'solprompter:tp-notch-size'; // { w, h } notch prompter block
export const LS_TP_NOTCH_EDIT_SIZE = 'solprompter:tp-notch-edit-size'; // { w, h } notch edit panel
export const LS_TP_FIRST_VISIT_TOUR = 'solprompter:tp-first-visit-tour-v1';
export const LS_TP_RECORD_BUTTON_TOUR = 'solprompter:tp-record-button-tour-v1';
export const LS_SE_FIRST_VISIT_TOUR = 'solprompter:se-first-visit-tour-v1';
export const LS_SUPPORT_VISIT_COUNT = 'solprompter:support-visit-count';

// Up to 12 most-recent BCP-47 locales whose on-device speech packs were
// requested by Voice Scroll. The browser owns the packs; this registry only
// lets the Studio verify/recover them on a later visit.
export const LS_VOICE_SCROLL_ASR_LOCALES = 'solprompter:voice-scroll-asr-locales';

// Cookie / analytics consent decision ('granted' | 'denied').
// Written by utils/cookie-consent.js; read by firebase-init.js.
// KEY must match CONSENT_KEY in utils/cookie-consent.js.
export const LS_ANALYTICS_CONSENT = 'solprompter:analytics-consent';

// Polar license entered on /license. The key stays on this device; app code
// reads it only through the license logic and the storage wrapper above.
export const LS_LICENSE = 'solprompter:license-v1';

// Local calendar-month usage for the free Auto Scroll allowance.
export const LS_AUTO_SCROLL_USAGE = 'solprompter:auto-scroll-usage-v1';
