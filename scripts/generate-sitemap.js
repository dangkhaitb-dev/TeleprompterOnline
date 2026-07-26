#!/usr/bin/env node

// Auto-generates public/sitemap.xml from the HTML that 11ty emits to the repo
// root (+ blog/<slug>/index.html and future pages/<lang>/index.html). Runs in
// the build pipeline between `build:11ty` and `vite build` (see gen:sitemap).
//
// Pages carrying `<meta name="robots" content="noindex">` (e.g. the app views
// teleprompter.html, workspaces.html) are skipped so the sitemap only lists
// indexable URLs. `lastmod` comes from the file's last git commit date.

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG = {
  baseUrl: (process.env.SITE_URL || 'https://vteleprompter.com').replace(/\/$/, ''),
  rootDir: path.resolve(__dirname, '..'),
  blogDir: path.resolve(__dirname, '../blog'),
  pagesDir: path.resolve(__dirname, '../pages'),
  outputPath: path.resolve(__dirname, '../public/sitemap.xml'),
  changefreq: 'weekly',
  defaultPriority: 0.8,
  homePriority: 1.0,
  fallbackLastmod: new Date().toISOString().split('T')[0],
};

const EXCLUDE_FILES = ['404.html'];

function isNoindex(absPath) {
  try {
    const html = fs.readFileSync(absPath, 'utf-8');
    return /<meta[^>]+name=["']robots["'][^>]*noindex/i.test(html);
  } catch {
    return false;
  }
}

function getLastmod(relPath) {
  try {
    const date = execSync(`git log -1 --format=%aI -- "${relPath}"`, {
      cwd: CONFIG.rootDir,
      encoding: 'utf-8',
    }).trim();
    return date ? date.split('T')[0] : CONFIG.fallbackLastmod;
  } catch {
    return CONFIG.fallbackLastmod;
  }
}

function urlEntry(loc, lastmod, priority, alternatesXml = '') {
  return `  <url>
    <loc>${loc}</loc>${alternatesXml}
    <lastmod>${lastmod}</lastmod>
    <changefreq>${CONFIG.changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

// blog/<slug>/index.html -> { relPath, urlPath }
function collectBlogArticles() {
  if (!fs.existsSync(CONFIG.blogDir)) return [];
  return fs
    .readdirSync(CONFIG.blogDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(CONFIG.blogDir, e.name, 'index.html')))
    .map((e) => ({ relPath: `blog/${e.name}/index.html`, urlPath: `blog/${e.name}` }));
}

// pages/<lang>/index.html -> localized home pages. The directory name is the
// language code (e.g. es, vi, zh-Hant), also used as the hreflang value.
function collectLangPages() {
  if (!fs.existsSync(CONFIG.pagesDir)) return [];
  return fs
    .readdirSync(CONFIG.pagesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(CONFIG.pagesDir, e.name, 'index.html')))
    .map((e) => ({ relPath: `pages/${e.name}/index.html`, urlPath: `${e.name}/`, isHome: true, hreflang: e.name }));
}

// Build the shared <xhtml:link> alternates block attached to every home-page
// URL (root + each localized home), so search engines see them as one clustered
// set. x-default points at the default-language root.
function buildHomeAlternates(homeEntries) {
  const links = homeEntries.map(
    (e) => `\n    <xhtml:link rel="alternate" hreflang="${e.hreflang}" href="${CONFIG.baseUrl}/${e.urlPath}"/>`
  );
  links.push(`\n    <xhtml:link rel="alternate" hreflang="x-default" href="${CONFIG.baseUrl}/"/>`);
  return links.join('');
}

function generateSitemap() {
  console.log('🗺️  Generating sitemap...');

  const entries = [];

  // Root-level pages emitted by 11ty (index.html, about.html, blog.html, ...)
  for (const file of fs.readdirSync(CONFIG.rootDir).filter((f) => f.endsWith('.html'))) {
    if (EXCLUDE_FILES.includes(file)) continue;
    if (isNoindex(path.join(CONFIG.rootDir, file))) {
      console.log(`   ↳ skip noindex: ${file}`);
      continue;
    }
    const slug = file.replace(/\.html$/, '');
    const isHome = slug === 'index';
    entries.push({
      relPath: file,
      urlPath: isHome ? '' : slug,
      priority: isHome ? CONFIG.homePriority : CONFIG.defaultPriority,
      isHome,
      hreflang: isHome ? 'en' : undefined,
    });
  }

  // Localized home pages: pages/<lang>/index.html
  for (const page of collectLangPages()) {
    if (isNoindex(path.join(CONFIG.rootDir, page.relPath))) continue;
    entries.push({ relPath: page.relPath, urlPath: page.urlPath, priority: CONFIG.homePriority, isHome: true, hreflang: page.hreflang });
  }

  // Blog articles: blog/<slug>/index.html
  for (const article of collectBlogArticles()) {
    if (isNoindex(path.join(CONFIG.rootDir, article.relPath))) continue;
    entries.push({ relPath: article.relPath, urlPath: article.urlPath, priority: CONFIG.defaultPriority });
  }

  const sorted = entries.sort((a, b) => a.urlPath.localeCompare(b.urlPath));
  const homeAlternatesXml = buildHomeAlternates(sorted.filter((e) => e.isHome));

  const urls = sorted.map((e) =>
    urlEntry(
      `${CONFIG.baseUrl}/${e.urlPath}`,
      getLastmod(e.relPath),
      e.priority,
      e.isHome ? homeAlternatesXml : ''
    )
  );

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`;

  fs.mkdirSync(path.dirname(CONFIG.outputPath), { recursive: true });
  fs.writeFileSync(CONFIG.outputPath, sitemap, 'utf-8');
  console.log(`✅ Sitemap generated (${urls.length} URLs) -> ${path.relative(CONFIG.rootDir, CONFIG.outputPath)}`);
}

try {
  generateSitemap();
} catch (e) {
  console.error('❌ Error generating sitemap:', e);
  process.exit(1);
}
