// permission-illustrations.js — per-step screenshots for the "permission blocked"
// popup. Real browser captures, cropped and marked with a red box on the exact
// control to tap; personal data (name, dev URL) removed. Files live in
// public/media/permission/ and are served from /media/permission/.
//
// illustrationsFor(stepsKey) returns markup aligned with copy.steps[key];
// '' means the step has no image (e.g. the final "Reload the page" step, and
// browsers we don't have captures for — Firefox / Safari desktop, other mobile).

const img = (name) =>
  `<img src="/media/permission/${name}.webp" alt="" loading="lazy" decoding="async" />`;

const SCENES = {
  desktopChromium: [img('perm-desktop-1'), img('perm-desktop-2'), ''],
  desktopEdge: [img('perm-edge-1'), img('perm-edge-2'), ''],
  desktopFirefox: ['', '', ''],
  desktopSafari: ['', '', ''],
  iosSafari: [img('perm-ios-1'), img('perm-ios-2'), ''],
  iosOther: ['', ''],
  android: [img('perm-android-1'), img('perm-android-2'), img('perm-android-3'), ''],
  fallback: ['', ''],
};

export function illustrationsFor(stepsKey) {
  return SCENES[stepsKey] || [];
}
