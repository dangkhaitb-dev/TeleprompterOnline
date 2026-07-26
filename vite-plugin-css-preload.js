/**
 * Vite plugin to optimize CSS loading:
 * 1. Move CSS links before scripts (parallel download)
 * 2. Async load non-critical CSS (checkout, login) using media="print" trick
 */
export default function cssPreload() {
  const NON_CRITICAL_CSS = ['checkout', 'login'];

  return {
    name: 'css-preload',
    enforce: 'post',
    transformIndexHtml(html) {
      const cssLinkRegex = /<link[^>]+rel="stylesheet"[^>]+href="(\/assets\/[^"]+\.css)"[^>]*>/g;
      const matches = [...html.matchAll(cssLinkRegex)];

      if (matches.length === 0) return html;

      let result = html;
      const criticalLinks = [];
      const asyncLinks = [];

      matches.forEach(match => {
        const fullTag = match[0];
        const href = match[1];
        result = result.replace(fullTag, '');

        const isNonCritical = NON_CRITICAL_CSS.some(name => href.includes(name));

        if (isNonCritical) {
          const asyncTag = `<link rel="stylesheet" href="${href}" media="print" onload="this.media='all'" crossorigin>`;
          asyncLinks.push(asyncTag);
        } else {
          criticalLinks.push(fullTag);
        }
      });

      const preloadEndMatch = result.match(/<link[^>]+rel="preload"[^>]+>[^<]*(?=<link rel="preconnect"|<link rel="stylesheet"|<script)/);

      const cssBlock = '\n    ' + [...criticalLinks, ...asyncLinks].join('\n    ');

      if (preloadEndMatch) {
        const insertPos = preloadEndMatch.index + preloadEndMatch[0].length;
        result = result.slice(0, insertPos) + cssBlock + result.slice(insertPos);
      } else {
        const headScriptMatch = result.match(/<head>[\s\S]*?(<script)/);
        if (headScriptMatch) {
          const scriptPos = result.indexOf(headScriptMatch[1], result.indexOf('<head>'));
          result = result.slice(0, scriptPos) + cssBlock + '\n    ' + result.slice(scriptPos);
        }
      }

      return result;
    }
  };
}
