// prefetch-page.js — warm the browser cache for a *next* page's assets while
// the user is still on the current page.
//
// The home → teleprompter jump is a full MPA navigation, so on a first visit
// the teleprompter's heavy JS + CSS bundle only starts downloading *after* the
// click — and on the home page a paste submits immediately, leaving no time to
// warm anything. Here we fetch the target HTML once, read its hashed asset URLs
// (so we never hardcode a build hash), and drop low-priority
// `<link rel="prefetch">` hints. The real navigation is then served from cache.
//
// Best-effort throughout: any failure is swallowed, and the layer stays testable
// under the node test runner by accepting injected `doc`/`fetch`/`connection`.

// Pull module-script and stylesheet URLs out of a built HTML document. Uses
// regex rather than DOMParser so it runs in the node test environment (no jsdom).
export function extractAssetUrls(html) {
  const urls = [];
  const add = (url) => {
    if (url && !urls.includes(url)) urls.push(url);
  };

  const scriptRe = /<script\b[^>]*?\btype=["']module["'][^>]*>/gi;
  for (let match; (match = scriptRe.exec(html)); ) {
    const src = /\bsrc=["']([^"']+)["']/.exec(match[0]);
    if (src) add(src[1]);
  }

  const linkRe = /<link\b[^>]*>/gi;
  for (let match; (match = linkRe.exec(html)); ) {
    if (!/\brel=["'](?:modulepreload|stylesheet)["']/i.test(match[0])) continue;
    const href = /\bhref=["']([^"']+)["']/.exec(match[0]);
    if (href) add(href[1]);
  }

  return urls;
}

// Take the markup inside <body>…</body>, dropping the entry <script> tags
// (innerHTML never executes scripts anyway, but the dead nodes would linger).
// Inert scripts like the #tpCopy JSON block are kept. Regex, not DOMParser,
// so it stays testable under the node test runner.
export function extractBodyHtml(html) {
  if (!html) return '';
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
  if (!body) return '';
  return body[1]
    .replace(/<script\b[^>]*\btype=["']module["'][^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\bsrc=["'][^"']*["'][^>]*>[\s\S]*?<\/script>/gi, '')
    .trim();
}

// True unless the connection is data-saver or 2g, where prefetching would waste
// the user's bandwidth.
export function connectionAllowsPrefetch(connection) {
  if (!connection) return true;
  if (connection.saveData) return false;
  return !/(?:^|-)2g$/.test(connection.effectiveType || '');
}

// In-flight/settled HTML fetches this session, keyed by absolute URL. Caching
// the *promise* (not the resolved string) lets concurrent callers — the
// idle-time warm and an open-time consumer — share a single request instead
// of racing duplicate downloads.
const pageHtmlCache = new Map();

// Fetch `url` and return a promise of its HTML string (cached per absolute
// URL), or null on any failure — callers fall back to a real navigation.
// Failed fetches are evicted from the cache so a later call can retry.
//
// `options.priority` (Priority Hints) defaults to 'low' for the idle-time warm
// so it never competes with the current page's load. Click-path callers pass
// 'high' — the user is actively waiting on this request to mount the studio.
// Note: memoization means the first caller's priority wins; a warm already
// in flight can't be upgraded, but the cold-click case (no warm yet) gets the
// high hint, which is exactly when it matters most.
export function fetchPageHtml(url, options = {}) {
  const doc = options.doc ?? (typeof document !== 'undefined' ? document : null);
  const fetchImpl = options.fetch ?? (typeof fetch !== 'undefined' ? fetch : null);
  const cache = options.cache ?? pageHtmlCache;
  const priority = options.priority ?? 'low';
  if (!fetchImpl) return Promise.resolve(null);

  let target;
  try {
    const base = (doc && doc.baseURI) || url;
    target = new URL(url, base).href;
  } catch {
    return Promise.resolve(null);
  }
  if (cache.has(target)) return cache.get(target);

  const pending = (async () => {
    try {
      const response = await fetchImpl(target, {
        credentials: 'same-origin',
        priority,
      });
      if (!response || !response.ok) return null;
      return await response.text();
    } catch {
      return null;
    }
  })();

  cache.set(target, pending);
  pending.then((html) => {
    if (html === null) cache.delete(target);
  });
  return pending;
}

// Fetch `url` once, then inject prefetch hints for the document and every
// module/stylesheet asset it references. Idempotent per-URL (skips links that
// already exist), but callers should still gate repeat invocations.
export async function prefetchPageAssets(url, options = {}) {
  const doc = options.doc ?? (typeof document !== 'undefined' ? document : null);
  const fetchImpl = options.fetch ?? (typeof fetch !== 'undefined' ? fetch : null);
  const connection =
    options.connection ??
    (typeof navigator !== 'undefined' ? navigator.connection : null);

  if (!doc || !fetchImpl) return;
  if (!connectionAllowsPrefetch(connection)) return;

  try {
    const base = doc.baseURI || url;
    const target = new URL(url, base).href;
    injectPrefetch(doc, target);

    const html = await fetchPageHtml(url, options);
    if (!html) return;
    for (const asset of extractAssetUrls(html)) {
      injectPrefetch(doc, new URL(asset, target).href);
    }
  } catch {
    // Prefetch is a best-effort optimization; never surface failures.
  }
}

function injectPrefetch(doc, href) {
  if (doc.querySelector(`link[rel="prefetch"][href="${cssEscape(href)}"]`)) return;
  const link = doc.createElement('link');
  link.rel = 'prefetch';
  link.href = href;
  doc.head.appendChild(link);
}

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}
