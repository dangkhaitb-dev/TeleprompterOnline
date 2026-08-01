const fs = require('fs');
const path = require('path');

const allocateUniqueId = (baseId, allocatedIds) => {
  let candidateId = baseId;
  let suffix = 2;

  while (allocatedIds.has(candidateId)) {
    candidateId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  allocatedIds.add(candidateId);
  return candidateId;
};

const stripHtml = (value) => String(value)
  .replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .trim();

const codeLineFromBlock = (block) => {
  if (block.type === 'paragraph') return stripHtml(block.html);
  if (block.type === 'quote') return stripHtml(block.text);
  if (block.type === 'list') {
    return block.items.map((item) => {
      const title = item.title ? `${stripHtml(item.title)}: ` : '';
      return `- ${title}${stripHtml(item.text)}`;
    }).join('\n');
  }
  return '';
};

const transformFencedCodeBlocks = (content, file) => {
  const transformed = [];

  for (let index = 0; index < content.length; index += 1) {
    const block = content[index];
    const fence = block.type === 'paragraph' && /^```([a-z0-9+-]*)\s*$/i.exec(block.html.trim());

    if (!fence) {
      transformed.push(block);
      continue;
    }

    const codeLines = [];
    let closingIndex = index + 1;

    while (closingIndex < content.length) {
      const candidate = content[closingIndex];
      if (candidate.type === 'paragraph' && candidate.html.trim() === '```') break;
      const line = codeLineFromBlock(candidate);
      if (line) codeLines.push(line);
      closingIndex += 1;
    }

    if (closingIndex === content.length) {
      throw new Error(`[articles] ${file}: code fence at content block ${index + 1} is not closed.`);
    }

    transformed.push({
      type: 'code',
      language: fence[1] || 'text',
      text: codeLines.join('\n'),
    });
    index = closingIndex;
  }

  return transformed;
};

function configureEleventy(eleventyConfig) {
  eleventyConfig.addWatchTarget('_templates/_data/');

  const articlesDataDir = path.join(__dirname, '_templates/_data/articles');
  const allowedArticleBlocks = new Set(['paragraph', 'heading', 'quote', 'list', 'image', 'toc', 'endnote', 'code']);
  const blogArticles = [];
  const slugifyUrlPart = (value) => String(value)
    .replace(/[Đđ]/g, (character) => character === 'Đ' ? 'D' : 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  // Parse a heading text that may contain a single Markdown link [label](url).
  // Returns { label, headingHtml } where label is plain text (used for IDs/TOC)
  // and headingHtml is safe HTML to render inside a heading element.
  const parseHeadingText = (text) => {
    const mdLink = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(text.trim());
    if (mdLink) {
      const label = mdLink[1];
      const url = mdLink[2];
      const safeLabel = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safeUrl = url.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      return { label, headingHtml: `<a href="${safeUrl}">${safeLabel}</a>` };
    }
    const safeText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return { label: text, headingHtml: safeText };
  };

  if (fs.existsSync(articlesDataDir)) {
    const articleFiles = fs.readdirSync(articlesDataDir)
      .filter((file) => file.endsWith('.json') && !file.startsWith('_'));

    for (const file of articleFiles) {
      const filePath = path.join(articlesDataDir, file);
      const article = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const requiredStrings = ['slug', 'title', 'category', 'date', 'dateDisplay', 'modified'];

      for (const field of requiredStrings) {
        if (typeof article[field] !== 'string' || !article[field].trim()) {
          throw new Error(`[articles] ${file}: "${field}" must be a non-empty string.`);
        }
      }

      const titleSlug = slugifyUrlPart(article.title);
      const categorySlug = slugifyUrlPart(article.category);

      if (!titleSlug) {
        throw new Error(`[articles] ${file}: "title" could not be converted to a URL slug.`);
      }

      if (!categorySlug) {
        throw new Error(`[articles] ${file}: "category" could not be converted to a URL slug.`);
      }

      // The strict title-slug matching requirement has been removed to support custom editorial slugs

      article.categorySlug = categorySlug;
      article.url = article.flatUrl ? '/blog/' + article.slug + '/' : '/blog/' + article.categorySlug + '/' + article.slug + '/';

      if (!article.seo?.title || !article.seo?.description) {
        throw new Error(`[articles] ${file}: "seo.title" and "seo.description" are required.`);
      }

      if (!article.author?.name || !article.author?.type || !article.author?.url) {
        throw new Error(`[articles] ${file}: author type, name and URL are required.`);
      }

      if (!article.review?.by || !article.review?.updatedDisplay) {
        throw new Error(`[articles] ${file}: "review.by" and "review.updatedDisplay" are required.`);
      }

      if (!article.hero?.src || !article.hero?.alt || !article.hero?.width || !article.hero?.height) {
        throw new Error(`[articles] ${file}: hero src, alt, width and height are required.`);
      }

      if (!Array.isArray(article.content) || article.content.length === 0) {
        throw new Error(`[articles] ${file}: "content" must contain at least one block.`);
      }

      article.content = transformFencedCodeBlocks(article.content, file);

      const allocatedHeadingIds = new Set(['article-content', 'article-toc-title']);
      const tocItems = [];
      let currentTocSection = null;
      let tocBlockCount = 0;

      article.content.forEach((block, index) => {
        if (!allowedArticleBlocks.has(block.type)) {
          throw new Error(`[articles] ${file}: content block ${index + 1} has unsupported type "${block.type}".`);
        }

        if (block.type === 'toc') {
          tocBlockCount += 1;
          if (typeof block.title !== 'string' || !block.title.trim()) {
            throw new Error(`[articles] ${file}: table-of-contents block ${index + 1} requires a title.`);
          }
          if (tocBlockCount > 1) {
            throw new Error(`[articles] ${file}: only one table-of-contents block is allowed.`);
          }
        }

        if (block.type !== 'heading') return;

        if (block.includeInToc && block.level !== 3) {
          throw new Error(`[articles] ${file}: only level-three headings may opt into the table of contents.`);
        }

        const { label: headingLabel, headingHtml } = parseHeadingText(block.text);
        block.headingHtml = headingHtml;

        const baseHeadingId = slugifyUrlPart(headingLabel);
        if (!baseHeadingId) {
          throw new Error(`[articles] ${file}: heading ${index + 1} could not be converted to an anchor.`);
        }

        block.id = allocateUniqueId(baseHeadingId, allocatedHeadingIds);

        if (block.level === 3) {
          if (block.includeInToc && !currentTocSection) {
            throw new Error(`[articles] ${file}: heading ${index + 1} cannot enter the table of contents before a level-two heading.`);
          }
          if (block.includeInToc) {
            currentTocSection.children.push({ id: block.id, text: headingLabel });
          }
          return;
        }

        currentTocSection = {
          id: block.id,
          text: headingLabel,
          children: [],
        };
        tocItems.push(currentTocSection);
      });

      article.tocItems = tocItems;

      if (blogArticles.some((item) => item.slug === article.slug)) {
        throw new Error(`[articles] Duplicate slug "${article.slug}".`);
      }

      if (article.published !== false) blogArticles.push(article);
    }
  }

  blogArticles.sort((a, b) => new Date(b.date) - new Date(a.date));

  const blogCategoryBySlug = new Map();

  for (const article of blogArticles) {
    const existingCategory = blogCategoryBySlug.get(article.categorySlug);

    if (existingCategory && existingCategory.name !== article.category) {
      throw new Error(
        `[articles] Categories "${existingCategory.name}" and "${article.category}" resolve to the same slug "${article.categorySlug}".`
      );
    }

    if (existingCategory) {
      existingCategory.articles.push(article);
    } else {
      blogCategoryBySlug.set(article.categorySlug, {
        name: article.category,
        slug: article.categorySlug,
        articles: [article],
      });
    }
  }

  for (const category of blogCategoryBySlug.values()) {
    category.hasHub = blogArticles.some(a => a.slug === category.slug && a.flatUrl);
  }

  const blogCategories = [...blogCategoryBySlug.values()];
  const blogCategoryPages = blogCategories.filter(c => !c.hasHub);

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
  eleventyConfig.addGlobalData('blogCategories', blogCategories);
  eleventyConfig.addGlobalData('blogCategoryPages', blogCategoryPages);
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

  // Eleventy does not clean removed pagination outputs by default. The output
  // directory is entirely disposable, so rebuild it from a clean slate.
  eleventyConfig.on('eleventy.before', () => {
    const outputDir = path.join(__dirname, '_11ty-output');
    if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true });
  });

  // Copy generated HTML from _11ty-output into the matching project path so
  // Vite can pick up root pages and clean nested article routes.
  eleventyConfig.on('eleventy.after', () => {
    const outputDir = path.join(__dirname, '_11ty-output');
    const rootDir = __dirname;
    const generatedArticleMarker = 'Generated from _templates/_data/articles/*.json';
    const generatedSimplePageMarker = 'Generated from _templates/_data/simple-pages/*.json';
    const generatedLocaleMarker = 'Generated from the shared language registry and localized index data';

    if (!fs.existsSync(outputDir)) return;

    const destinationBlogDir = path.join(rootDir, 'blog');
    const generatedBlogDir = path.join(outputDir, 'blog');

    const removeStaleGeneratedBlogRoutes = (currentDestinationDir, currentGeneratedDir) => {
      if (!fs.existsSync(currentDestinationDir)) return;

      const routeItems = fs.readdirSync(currentDestinationDir, { withFileTypes: true });

      for (const routeItem of routeItems) {
        const destinationPath = path.join(currentDestinationDir, routeItem.name);
        const generatedPath = path.join(currentGeneratedDir, routeItem.name);

        if (routeItem.isDirectory()) {
          removeStaleGeneratedBlogRoutes(destinationPath, generatedPath);
          if (fs.readdirSync(destinationPath).length === 0) fs.rmdirSync(destinationPath);
          continue;
        }

        if (
          routeItem.isFile()
          && routeItem.name === 'index.html'
          && !fs.existsSync(generatedPath)
          && fs.readFileSync(destinationPath, 'utf-8').includes(generatedArticleMarker)
        ) {
          fs.unlinkSync(destinationPath);
          console.log(`[post-build] Removed stale blog route ${path.relative(destinationBlogDir, destinationPath)}`);
        }
      }
    };

    const removeStaleGeneratedRootPages = () => {
      for (const file of fs.readdirSync(rootDir).filter((name) => name.endsWith('.html'))) {
        const destinationPath = path.join(rootDir, file);
        const generatedPath = path.join(outputDir, file);
        if (
          !fs.existsSync(generatedPath)
          && fs.readFileSync(destinationPath, 'utf-8').includes(generatedSimplePageMarker)
        ) {
          fs.unlinkSync(destinationPath);
          console.log(`[post-build] Removed stale simple page ${file}`);
        }
      }
    };

    const removeStaleGeneratedLocaleRoutes = () => {
      const destinationPagesDir = path.join(rootDir, 'pages');
      const generatedPagesDir = path.join(outputDir, 'pages');
      if (!fs.existsSync(destinationPagesDir)) return;

      for (const route of fs.readdirSync(destinationPagesDir, { withFileTypes: true })) {
        if (!route.isDirectory()) continue;
        const destinationPath = path.join(destinationPagesDir, route.name, 'index.html');
        const generatedPath = path.join(generatedPagesDir, route.name, 'index.html');
        if (
          fs.existsSync(destinationPath)
          && !fs.existsSync(generatedPath)
          && fs.readFileSync(destinationPath, 'utf-8').includes(generatedLocaleMarker)
        ) {
          fs.unlinkSync(destinationPath);
          const routeDir = path.dirname(destinationPath);
          if (fs.readdirSync(routeDir).length === 0) fs.rmdirSync(routeDir);
          console.log(`[post-build] Removed stale locale route ${route.name}`);
        }
      }
    };

    removeStaleGeneratedBlogRoutes(destinationBlogDir, generatedBlogDir);
    removeStaleGeneratedRootPages();
    removeStaleGeneratedLocaleRoutes();

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
}

module.exports = configureEleventy;
module.exports.allocateUniqueId = allocateUniqueId;
