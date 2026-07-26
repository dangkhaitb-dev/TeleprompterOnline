const fs = require('fs');
const path = require('path');

module.exports = function (eleventyConfig) {
  eleventyConfig.addWatchTarget('_templates/_data/');

  const articlesDataDir = path.join(__dirname, '_templates/_data/articles');
  const allowedArticleBlocks = new Set(['paragraph', 'heading', 'quote', 'list', 'image', 'endnote']);
  const blogArticles = [];
  const slugifyArticleTitle = (title) => String(title)
    .replace(/[Đđ]/g, (character) => character === 'Đ' ? 'D' : 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (fs.existsSync(articlesDataDir)) {
    const articleFiles = fs.readdirSync(articlesDataDir)
      .filter((file) => file.endsWith('.json') && !file.startsWith('_'));

    for (const file of articleFiles) {
      const filePath = path.join(articlesDataDir, file);
      const article = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const requiredStrings = ['slug', 'title', 'date', 'dateDisplay', 'modified'];

      for (const field of requiredStrings) {
        if (typeof article[field] !== 'string' || !article[field].trim()) {
          throw new Error(`[articles] ${file}: "${field}" must be a non-empty string.`);
        }
      }

      const titleSlug = slugifyArticleTitle(article.title);

      if (!titleSlug) {
        throw new Error(`[articles] ${file}: "title" could not be converted to a URL slug.`);
      }

      if (article.slug !== titleSlug) {
        throw new Error(`[articles] ${file}: "slug" must be "${titleSlug}" to match the title.`);
      }

      if (!article.seo?.title || !article.seo?.description) {
        throw new Error(`[articles] ${file}: "seo.title" and "seo.description" are required.`);
      }

      if (!article.author?.name) {
        throw new Error(`[articles] ${file}: "author.name" is required.`);
      }

      if (!article.hero?.src || !article.hero?.alt || !article.hero?.width || !article.hero?.height) {
        throw new Error(`[articles] ${file}: hero src, alt, width and height are required.`);
      }

      if (!Array.isArray(article.content) || article.content.length === 0) {
        throw new Error(`[articles] ${file}: "content" must contain at least one block.`);
      }

      article.content.forEach((block, index) => {
        if (!allowedArticleBlocks.has(block.type)) {
          throw new Error(`[articles] ${file}: content block ${index + 1} has unsupported type "${block.type}".`);
        }
      });

      if (blogArticles.some((item) => item.slug === article.slug)) {
        throw new Error(`[articles] Duplicate slug "${article.slug}".`);
      }

      if (article.published !== false) blogArticles.push(article);
    }
  }

  blogArticles.sort((a, b) => new Date(b.date) - new Date(a.date));

  const simplePagesDataDir = path.join(__dirname, '_templates/_data/simple-pages');
  const allowedSimplePageBlocks = new Set(['paragraph', 'heading', 'list', 'image']);
  const reservedSimplePageSlugs = new Set(['blog', 'index', 'teleprompter', 'workspaces']);
  const simplePages = [];

  if (fs.existsSync(simplePagesDataDir)) {
    const simplePageFiles = fs.readdirSync(simplePagesDataDir)
      .filter((file) => file.endsWith('.json') && !file.startsWith('_'));

    for (const file of simplePageFiles) {
      const filePath = path.join(simplePagesDataDir, file);
      const simplePage = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const requiredStrings = ['slug', 'title'];

      for (const field of requiredStrings) {
        if (typeof simplePage[field] !== 'string' || !simplePage[field].trim()) {
          throw new Error(`[simple-pages] ${file}: "${field}" must be a non-empty string.`);
        }
      }

      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(simplePage.slug)) {
        throw new Error(`[simple-pages] ${file}: "slug" must contain lowercase words separated by hyphens.`);
      }

      if (reservedSimplePageSlugs.has(simplePage.slug)) {
        throw new Error(`[simple-pages] ${file}: slug "${simplePage.slug}" is reserved by an existing page.`);
      }

      if (!simplePage.seo?.title || !simplePage.seo?.description) {
        throw new Error(`[simple-pages] ${file}: "seo.title" and "seo.description" are required.`);
      }

      if (!Array.isArray(simplePage.content) || simplePage.content.length === 0) {
        throw new Error(`[simple-pages] ${file}: "content" must contain at least one block.`);
      }

      simplePage.content.forEach((block, index) => {
        if (!allowedSimplePageBlocks.has(block.type)) {
          throw new Error(`[simple-pages] ${file}: content block ${index + 1} has unsupported type "${block.type}".`);
        }
      });

      if (simplePages.some((item) => item.slug === simplePage.slug)) {
        throw new Error(`[simple-pages] Duplicate slug "${simplePage.slug}".`);
      }

      if (simplePage.published !== false) simplePages.push(simplePage);
    }
  }

  const i18nBaseDir = path.join(__dirname, '_templates/_data/i18n');
  const i18nBase = {};
  if (fs.existsSync(i18nBaseDir)) {
    for (const file of fs.readdirSync(i18nBaseDir)) {
      if (file.endsWith('.json')) {
        const lang = file.replace('.json', '');
        i18nBase[lang] = JSON.parse(
          fs.readFileSync(path.join(i18nBaseDir, file), 'utf-8')
        );
      }
    }
  }

  const pagesDataDir = path.join(__dirname, '_templates/_data/pages');
  const i18nPages = {};
  if (fs.existsSync(pagesDataDir)) {
    for (const pageFolder of fs.readdirSync(pagesDataDir)) {
      const pagePath = path.join(pagesDataDir, pageFolder);
      if (!fs.statSync(pagePath).isDirectory()) continue;
      i18nPages[pageFolder] = {};
      for (const file of fs.readdirSync(pagePath)) {
        if (file.endsWith('.json')) {
          const lang = file.replace('.json', '');
          i18nPages[pageFolder][lang] = JSON.parse(
            fs.readFileSync(path.join(pagePath, file), 'utf-8')
          );
        }
      }
    }
  }

  eleventyConfig.addGlobalData('i18nBase', i18nBase);
  eleventyConfig.addGlobalData('i18nPages', i18nPages);
  eleventyConfig.addGlobalData('blogArticles', blogArticles);
  eleventyConfig.addGlobalData('simplePages', simplePages);

  const languages = require('./_templates/_data/languages.cjs');
  const langDirByCode = Object.fromEntries(languages.map((l) => [l.code, l.dir]));
  eleventyConfig.addFilter('langDir', (code) => langDirByCode[code] || 'ltr');

  eleventyConfig.addFilter('stripHtml', (str) =>
    str ? str.replace(/<[^>]*>/g, '') : ''
  );

  eleventyConfig.addFilter('dump', (obj) => JSON.stringify(obj, null, 2));

  eleventyConfig.addFilter('jsonString', (str) => {
    if (!str) return '';
    return String(str)
      .replace(/<[^>]*>/g, '')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, ' ')
      .replace(/\r/g, '')
      .replace(/\t/g, ' ');
  });

  // Eleventy does not clean removed pagination outputs by default. Blog routes
  // are entirely generated, so reset only that output subtree before writing.
  eleventyConfig.on('eleventy.before', () => {
    const outputBlogDir = path.join(__dirname, '_11ty-output', 'blog');
    if (fs.existsSync(outputBlogDir)) fs.rmSync(outputBlogDir, { recursive: true, force: true });
  });

  // Copy generated HTML from _11ty-output into the matching project path so
  // Vite can pick up root pages and clean nested article routes.
  eleventyConfig.on('eleventy.after', () => {
    const outputDir = path.join(__dirname, '_11ty-output');
    const rootDir = __dirname;
    const generatedMarker = 'Generated from _templates/_data/articles/*.json';

    if (!fs.existsSync(outputDir)) return;

    const destinationBlogDir = path.join(rootDir, 'blog');
    const generatedBlogDir = path.join(outputDir, 'blog');

    if (fs.existsSync(destinationBlogDir)) {
      const routeDirs = fs.readdirSync(destinationBlogDir, { withFileTypes: true })
        .filter((item) => item.isDirectory());

      for (const routeDir of routeDirs) {
        const destinationIndex = path.join(destinationBlogDir, routeDir.name, 'index.html');
        const generatedIndex = path.join(generatedBlogDir, routeDir.name, 'index.html');

        if (
          fs.existsSync(destinationIndex)
          && !fs.existsSync(generatedIndex)
          && fs.readFileSync(destinationIndex, 'utf-8').includes(generatedMarker)
        ) {
          fs.unlinkSync(destinationIndex);
          const destinationRouteDir = path.dirname(destinationIndex);
          if (fs.readdirSync(destinationRouteDir).length === 0) fs.rmdirSync(destinationRouteDir);
          console.log(`[post-build] Removed stale blog route ${routeDir.name}`);
        }
      }
    }

    const copyHtml = (currentDir) => {
      const items = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const item of items) {
        const sourcePath = path.join(currentDir, item.name);

        if (item.isDirectory()) {
          copyHtml(sourcePath);
          continue;
        }

        if (item.isFile() && item.name.endsWith('.html')) {
          const relativePath = path.relative(outputDir, sourcePath);
          const destinationPath = path.join(rootDir, relativePath);
          fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
          fs.copyFileSync(sourcePath, destinationPath);
          console.log(`[post-build] Copied ${relativePath} → project`);
        }
      }
    };

    copyHtml(outputDir);
  });

  return {
    dir: {
      input: '_templates',
      output: '_11ty-output',
      includes: '_includes',
      data: '_data',
    },
    templateFormats: ['njk'],
    htmlTemplateEngine: 'njk',
    markdownTemplateEngine: 'njk',
  };
};
