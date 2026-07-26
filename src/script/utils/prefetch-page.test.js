import { describe, expect, it, vi } from 'vitest';
import {
  extractAssetUrls,
  extractBodyHtml,
  connectionAllowsPrefetch,
  fetchPageHtml,
  prefetchPageAssets,
} from './prefetch-page.js';

const HTML = `
  <!doctype html><html><head>
    <link rel="stylesheet" crossorigin href="/assets/teleprompter-abc.css">
    <link rel="modulepreload" href="/assets/firebase-xyz.js">
    <link rel="icon" href="/favicon.svg">
    <script type="module" crossorigin src="/assets/teleprompter-def.js"></script>
    <script>console.log('inline, ignored')</script>
  </head><body></body></html>`;

// Minimal document stand-in — the util only needs these four surfaces.
function makeDoc() {
  const links = [];
  return {
    baseURI: 'https://vteleprompter.test/',
    head: { appendChild: (el) => links.push(el) },
    createElement: () => ({ rel: '', href: '' }),
    querySelector: (selector) => {
      const match = /href="([^"]+)"/.exec(selector);
      const href = match ? match[1].replace(/\\(.)/g, '$1') : null;
      return links.find((l) => l.rel === 'prefetch' && l.href === href) || null;
    },
    prefetched: links,
  };
}

describe('extractAssetUrls', () => {
  it('pulls module scripts + modulepreload + stylesheet URLs, ignoring the rest', () => {
    expect(extractAssetUrls(HTML)).toEqual([
      '/assets/teleprompter-def.js',
      '/assets/teleprompter-abc.css',
      '/assets/firebase-xyz.js',
    ]);
  });

  it('dedupes repeated URLs', () => {
    const html = `
      <script type="module" src="/a.js"></script>
      <link rel="modulepreload" href="/a.js">`;
    expect(extractAssetUrls(html)).toEqual(['/a.js']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(extractAssetUrls('<html><body>no assets</body></html>')).toEqual([]);
  });
});

describe('extractBodyHtml', () => {
  const PAGE = `
    <!doctype html><html><head><title>t</title></head>
    <body class="tp">
      <script type="application/json" id="tpCopy">{"toast":{"saved":"Saved"}}</script>
      <main class="app" id="app"><h1>Studio</h1></main>
      <script type="module" crossorigin src="/assets/teleprompter-def.js"></script>
    </body></html>`;

  it('returns the inner body markup with entry scripts stripped', () => {
    const inner = extractBodyHtml(PAGE);
    expect(inner).toContain('<main class="app" id="app">');
    expect(inner).toContain('id="tpCopy"');
    expect(inner).toContain('{"toast":{"saved":"Saved"}}');
    expect(inner).not.toContain('type="module"');
    expect(inner).not.toContain('teleprompter-def.js');
  });

  it('strips plain src scripts too', () => {
    const inner = extractBodyHtml('<body><div id="x"></div><script src="/a.js"></script></body>');
    expect(inner).toBe('<div id="x"></div>');
  });

  it('returns empty string when there is no body or no input', () => {
    expect(extractBodyHtml('<html><head></head></html>')).toBe('');
    expect(extractBodyHtml('')).toBe('');
    expect(extractBodyHtml(null)).toBe('');
  });
});

describe('connectionAllowsPrefetch', () => {
  it('allows when connection info is unavailable', () => {
    expect(connectionAllowsPrefetch(null)).toBe(true);
  });

  it('blocks on data-saver', () => {
    expect(connectionAllowsPrefetch({ saveData: true })).toBe(false);
  });

  it('blocks on 2g / slow-2g but allows faster tiers', () => {
    expect(connectionAllowsPrefetch({ effectiveType: '2g' })).toBe(false);
    expect(connectionAllowsPrefetch({ effectiveType: 'slow-2g' })).toBe(false);
    expect(connectionAllowsPrefetch({ effectiveType: '4g' })).toBe(true);
  });
});

describe('fetchPageHtml', () => {
  it('fetches once and serves repeat calls from the cache', async () => {
    const doc = makeDoc();
    const cache = new Map();
    const fetchImpl = vi.fn(async () => ({ ok: true, text: async () => HTML }));

    const first = await fetchPageHtml('/teleprompter', { doc, fetch: fetchImpl, cache });
    const second = await fetchPageHtml('/teleprompter', { doc, fetch: fetchImpl, cache });

    expect(first).toBe(HTML);
    expect(second).toBe(HTML);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('https://vteleprompter.test/teleprompter', {
      credentials: 'same-origin',
      priority: 'low',
    });
  });

  it('returns null on network failure or non-ok response without caching', async () => {
    const doc = makeDoc();
    const cache = new Map();
    const failing = vi.fn(async () => {
      throw new Error('network down');
    });
    const notOk = vi.fn(async () => ({ ok: false }));

    expect(await fetchPageHtml('/teleprompter', { doc, fetch: failing, cache })).toBeNull();
    expect(await fetchPageHtml('/teleprompter', { doc, fetch: notOk, cache })).toBeNull();
    // A failed fetch is evicted so a later call can retry.
    expect(cache.size).toBe(0);
  });

  it('defaults to low priority but forwards an explicit priority hint', async () => {
    const doc = makeDoc();
    const fetchImpl = vi.fn(async () => ({ ok: true, text: async () => HTML }));

    await fetchPageHtml('/warm', { doc, fetch: fetchImpl, cache: new Map() });
    await fetchPageHtml('/click', { doc, fetch: fetchImpl, cache: new Map(), priority: 'high' });

    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'https://vteleprompter.test/warm', {
      credentials: 'same-origin',
      priority: 'low',
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'https://vteleprompter.test/click', {
      credentials: 'same-origin',
      priority: 'high',
    });
  });

  it('shares one in-flight request between concurrent callers', async () => {
    const doc = makeDoc();
    const cache = new Map();
    const fetchImpl = vi.fn(async () => ({ ok: true, text: async () => HTML }));

    // Fire both before the first resolves — they must join the same request.
    const [a, b] = await Promise.all([
      fetchPageHtml('/teleprompter', { doc, fetch: fetchImpl, cache }),
      fetchPageHtml('/teleprompter', { doc, fetch: fetchImpl, cache }),
    ]);

    expect(a).toBe(HTML);
    expect(b).toBe(HTML);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('caches per absolute URL', async () => {
    const doc = makeDoc();
    const cache = new Map();
    const fetchImpl = vi.fn(async (url) => ({ ok: true, text: async () => `page:${url}` }));

    await fetchPageHtml('/a', { doc, fetch: fetchImpl, cache });
    await fetchPageHtml('/b', { doc, fetch: fetchImpl, cache });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // The cache holds the settled fetch promise, keyed per absolute URL.
    expect(await cache.get('https://vteleprompter.test/a')).toBe('page:https://vteleprompter.test/a');
    expect(await cache.get('https://vteleprompter.test/b')).toBe('page:https://vteleprompter.test/b');
  });
});

describe('prefetchPageAssets', () => {
  it('prefetches the document and each of its assets', async () => {
    const doc = makeDoc();
    const fetchImpl = vi.fn(async () => ({ ok: true, text: async () => HTML }));

    await prefetchPageAssets('/teleprompter.html', { doc, fetch: fetchImpl, cache: new Map() });

    expect(fetchImpl).toHaveBeenCalledWith('https://vteleprompter.test/teleprompter.html', {
      credentials: 'same-origin',
      priority: 'low',
    });
    expect(doc.prefetched.map((l) => l.href)).toEqual([
      'https://vteleprompter.test/teleprompter.html',
      'https://vteleprompter.test/assets/teleprompter-def.js',
      'https://vteleprompter.test/assets/teleprompter-abc.css',
      'https://vteleprompter.test/assets/firebase-xyz.js',
    ]);
    expect(doc.prefetched.every((l) => l.rel === 'prefetch')).toBe(true);
  });

  it('skips entirely on a data-saver connection', async () => {
    const doc = makeDoc();
    const fetchImpl = vi.fn();

    await prefetchPageAssets('/teleprompter.html', {
      doc,
      fetch: fetchImpl,
      connection: { saveData: true },
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(doc.prefetched).toHaveLength(0);
  });

  it('does not throw when the fetch fails', async () => {
    const doc = makeDoc();
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });

    await expect(
      prefetchPageAssets('/teleprompter.html', { doc, fetch: fetchImpl, cache: new Map() }),
    ).resolves.toBeUndefined();
    // The document hint is injected before the fetch, then the error is swallowed.
    expect(doc.prefetched.map((l) => l.href)).toEqual([
      'https://vteleprompter.test/teleprompter.html',
    ]);
  });

  it('does not inject duplicate prefetch links', async () => {
    const doc = makeDoc();
    const cache = new Map();
    const fetchImpl = vi.fn(async () => ({ ok: true, text: async () => HTML }));

    await prefetchPageAssets('/teleprompter.html', { doc, fetch: fetchImpl, cache });
    await prefetchPageAssets('/teleprompter.html', { doc, fetch: fetchImpl, cache });

    // 1 document + 3 assets, not doubled.
    expect(doc.prefetched).toHaveLength(4);
  });
});
