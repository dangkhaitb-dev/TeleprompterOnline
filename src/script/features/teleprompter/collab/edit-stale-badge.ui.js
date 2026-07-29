// edit-stale-badge.ui.js — a small, self-contained "you're viewing an older
// version" indicator for the teleprompter EDIT view.
//
// When another tab saves newer CONTENT for the SAME script (settings are out of
// scope), this tab (still showing the old version) surfaces a discreet badge
// inviting a reload. It only reflects state; it never replays the other tab's
// actions (see the invariant in utils/cross-tab-sync.js). Sync scope is the edit
// view only — paused during Play/Record via `isSyncPaused` + the `modeEl`
// observer — and the badge is desktop-only (hidden on mobile via CSS).
//
// Deliberately minimal: "Reload" does a full page reload rather than surgically
// merging the remote version into the live editor. That guarantees we never
// clobber text the user is mid-typing, and keeps this feature low-risk. The
// live-merge path is a Phase-2 concern (see cross-tab-sync.js).

import { onWorkspacesChanged } from '../../../utils/cross-tab-sync.js';
import { snapshotWorkspace, isStale } from './stale-detector.js';

// Options:
//   mount         — element to append the badge into. Use a TOP-LEVEL node
//                   (document.body), not the studio #app: #app/.stage create a
//                   stacking context that traps position:fixed children (same
//                   reason the shared toast mounts on document.body).
//   readWorkspace — () => fresh workspace object (or null) from the store
//   isSyncPaused  — () => true while Play/Record is active (skip reconciling)
//   modeEl        — the #app element whose classes reflect Play/Record mode;
//                   watched so the badge hides the moment playback starts
//   copy          — flat i18n map (staleBadge / staleBadgeReload keys)
//   reload        — override the reload action (defaults to window.location)
export function initEditStaleBadge({ mount, readWorkspace, isSyncPaused, modeEl, copy = {}, reload } = {}) {
  if (!mount || typeof readWorkspace !== 'function') {
    return { markLocalWrite() {}, destroy() {} };
  }

  const paused = () => typeof isSyncPaused === 'function' && isSyncPaused();

  // The version this tab treats as current. Advances on local writes and on
  // reload; a remote write that moves past it flips the badge on.
  let baseline = snapshotWorkspace(readWorkspace());

  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = 'tp-stale-badge';
  badge.dataset.analyticsName = 'reloadStaleClick';
  badge.hidden = true;
  badge.setAttribute('aria-live', 'polite');
  // Clear + concise, no separate action button — the whole pill reloads on click.
  badge.textContent = copy.staleBadge || 'Content updated in another tab — reload';
  badge.title = copy.staleBadgeReload || 'Reload to load the latest content';

  const doReload = typeof reload === 'function' ? reload : () => window.location.reload();
  const onClick = () => doReload();
  badge.addEventListener('click', onClick);
  mount.appendChild(badge);

  const handleRemote = () => {
    // Sync scope is the edit view only — ignore while Play/Record is active.
    if (paused()) return;
    const fresh = readWorkspace();
    if (!fresh) return;
    if (isStale(baseline, fresh)) badge.hidden = false;
  };

  const unsubscribe = onWorkspacesChanged(handleRemote);

  // Sync scope is the edit view only: hide the badge while Play/Record is
  // active, and keep it up (or bring it back) whenever we're in the edit view
  // and this tab is still behind — it must not vanish on its own while stale.
  const reconcileVisibility = () => {
    if (paused()) {
      badge.hidden = true;
      return;
    }
    const fresh = readWorkspace();
    badge.hidden = !(fresh && isStale(baseline, fresh));
  };
  let modeObserver = null;
  if (modeEl && typeof MutationObserver === 'function') {
    modeObserver = new MutationObserver(reconcileVisibility);
    modeObserver.observe(modeEl, { attributes: true, attributeFilter: ['class'] });
  }

  return {
    // Call after THIS tab persists CONTENT: it now holds the newest version, so
    // re-baseline and clear any stale badge.
    markLocalWrite() {
      baseline = snapshotWorkspace(readWorkspace());
      badge.hidden = true;
    },
    destroy() {
      unsubscribe();
      if (modeObserver) modeObserver.disconnect();
      badge.removeEventListener('click', onClick);
      badge.remove();
    },
  };
}
