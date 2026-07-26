// platform.js — best-effort OS/browser detection from the User-Agent.
// Used to show the right "re-enable camera/mic permission" steps, which differ
// per platform. This is a util so it may touch `navigator` (feature code can't).
// `nav` is injectable purely so the unit test can feed UA strings.

// Returns { os, browser, isMobile }.
//   os      : 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'other'
//   browser : 'chrome' | 'edge' | 'firefox' | 'safari' | 'other'
//   isMobile: boolean
export function detectPlatform(nav = typeof navigator !== 'undefined' ? navigator : {}) {
  const ua = nav.userAgent || '';
  const touchPoints = nav.maxTouchPoints || 0;

  // iPadOS ≥13 reports a desktop "Macintosh" UA, so sniff touch to catch it.
  const isIPhone = /iPhone|iPod/.test(ua);
  const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);

  let os = 'other';
  if (isIPhone || isIPad) os = 'ios';
  else if (/Android/.test(ua)) os = 'android';
  else if (/Macintosh|Mac OS X/.test(ua)) os = 'macos';
  else if (/Windows/.test(ua)) os = 'windows';
  else if (/Linux/.test(ua)) os = 'linux';

  // Order matters: Edge and Chrome UAs both contain "Safari"; iOS variants
  // (CriOS/FxiOS/EdgiOS) must win over the plain Safari fallback.
  let browser = 'other';
  if (/EdgiOS|Edg\//.test(ua)) browser = 'edge';
  else if (/CriOS|Chrome\//.test(ua) && !/OPR\//.test(ua)) browser = 'chrome';
  else if (/FxiOS|Firefox\//.test(ua)) browser = 'firefox';
  else if (/Safari\//.test(ua)) browser = 'safari';

  const uaDataMobile =
    nav.userAgentData && typeof nav.userAgentData.mobile === 'boolean'
      ? nav.userAgentData.mobile
      : null;
  const isMobile =
    uaDataMobile !== null
      ? uaDataMobile
      : os === 'ios' || os === 'android' || /Mobi/.test(ua);

  return { os, browser, isMobile };
}
