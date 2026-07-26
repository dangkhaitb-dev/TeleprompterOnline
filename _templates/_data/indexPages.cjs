// Index page routing — one pagination entry per language (see languages.cjs).
//
// Permalink layout MUST be `pages/<lang>/index.html` for non-default languages:
// Vite's input scan, the `organize-html-files` plugin, the dev URL rewriter and
// the sitemap generator all key off that `pages/<lang>/` path. The default
// language stays at the site root (`/index.html`). Vite later flattens
// `dist/pages/<lang>/` → `dist/<lang>/` for clean `/es/`-style URLs.
const languages = require('./languages.cjs');

module.exports = languages.map(({ code, isDefault }) => ({
  pageKey: 'index',
  lang: code,
  permalink: isDefault ? '/index.html' : `/pages/${code}/index.html`,
}));
