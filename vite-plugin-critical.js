/**
 * Vite Plugin: Critical CSS Inline with Critters
 *
 * Automatically extracts and inlines critical CSS for above-the-fold content
 * using Critters library. Runs post-build on generated HTML files.
 *
 * Benefits over Puppeteer approach:
 * - No preview server needed (processes static HTML)
 * - Simpler and more reliable
 * - Perfect for CI/CD environments
 * - Faster build times
 *
 * Configuration:
 * - path: dist/ directory where HTML files are located
 * - preload: 'swap' for non-critical CSS (prevents flash of unstyled content)
 * - inlineFonts: true to inline critical font declarations
 * - compress: true to minify inlined CSS
 * - pruneSource: true to remove inlined CSS from external stylesheets
 */

import Critters from 'critters';
import { resolve } from 'path';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

// `include`: restrict to these HTML basenames (empty = every page).
// `exclude`: skip these basenames. Excludes win over includes.
//
// The teleprompter is excluded by default: ~74% of its CSS is above-the-fold,
// so inlining just bloats the HTML (and its stylesheet is already prefetched
// from the home page). Critical CSS pays off on content/landing pages where the
// critical slice is small.
// Critters' preload:'swap' output leaves the external stylesheet link
// render-blocking (rel="stylesheet" plus a vestigial onload) while the same
// critical rules are already inlined above it — the page pays for both.
// Rewrite the marked links to the media-swap pattern so the full stylesheet
// loads without blocking first paint. Critters' <noscript> fallbacks are
// protected from the rewrite and kept as-is.
function deferSwappedStylesheets(html) {
  const noscriptBlocks = [];
  const protectedHtml = html.replace(/<noscript>[\s\S]*?<\/noscript>/g, (block) => {
    noscriptBlocks.push(block);
    return `<!--__critters-noscript-${noscriptBlocks.length - 1}__-->`;
  });
  const swapped = protectedHtml.replace(
    /<link\b([^>]*?)\sonload="this\.rel='stylesheet'"([^>]*)>/g,
    (match, before, after) => {
      if (/\bmedia=/.test(`${before}${after}`)) return match;
      return `<link${before} media="print" onload="this.media='all'"${after}>`;
    },
  );
  return swapped.replace(/<!--__critters-noscript-(\d+)__-->/g, (_, index) => noscriptBlocks[Number(index)]);
}

export default function criticalCss({ include = [], exclude = ['teleprompter.html'] } = {}) {
  return {
    name: 'vite-plugin-critical-css',
    apply: 'build', // only run on build, skip dev/HMR

    // Run after all assets are written to disk
    async closeBundle() {
      console.log('\n🎨 Extracting critical CSS with Critters...');

      const distPath = resolve(process.cwd(), 'dist');
      if (!existsSync(distPath)) {
        console.log('ℹ️  Skipping critical CSS: dist/ not found (dev or clean build).');
        return;
      }

      const critters = new Critters({
        path: distPath,
        publicPath: '/',
        // 'swap': inline critical CSS, then attach the full stylesheet after
        // load (rel=preload → stylesheet) so it never blocks first paint.
        preload: 'swap',
        inlineFonts: true,
        compress: true,
        // Keep external stylesheets whole — several are SHARED chunks (e.g. the
        // reset/tokens bundle) referenced by other pages, so pruning inlined
        // rules here would strip styles those pages still need.
        pruneSource: false,
        logLevel: 'info',
        // Additional config to ensure non-blocking CSS
        reduceInlineStyles: false,  // Don't reduce inline styles
        mergeStylesheets: false,    // Keep stylesheets separate
      });

      try {
        if (!existsSync(distPath)) {
          console.warn('⚠️  Skipping critical CSS: dist/ not found');
          return;
        }
        // Find all HTML files recursively in dist/
        function findHtmlFiles(dir) {
          const files = [];
          const items = readdirSync(dir);

          for (const item of items) {
            const fullPath = join(dir, item);
            const stat = statSync(fullPath);

            if (stat.isDirectory()) {
              // Recursively search subdirectories
              files.push(...findHtmlFiles(fullPath));
            } else if (item.endsWith('.html')) {
              files.push(fullPath);
            }
          }

          return files;
        }

        const allHtmlFiles = findHtmlFiles(distPath);
        // Empty `include` = every page; otherwise restrict by basename. Then
        // drop anything named in `exclude`.
        const htmlFiles = allHtmlFiles
          .filter((f) => !include.length || include.includes(f.split('/').pop()))
          .filter((f) => !exclude.includes(f.split('/').pop()));
        console.log(`📄 Found ${htmlFiles.length} HTML files to process`);

        // Process each HTML file
        for (const htmlFile of htmlFiles) {
          const fileName = htmlFile.split('/').pop();
          console.log(`   Processing: ${fileName}`);

          const html = readFileSync(htmlFile, 'utf-8');

          // Skip files that are not valid HTML documents
          // (e.g., site verification files that are plain text)
          if (!html.trim().startsWith('<!DOCTYPE') && !html.trim().startsWith('<html')) {
            console.log(`   ⏭️  ${fileName} - Skipped (not valid HTML document)`);
            continue;
          }

          const processedHtml = await critters.process(html);
          writeFileSync(htmlFile, deferSwappedStylesheets(processedHtml), 'utf-8');

          console.log(`   ✅ ${fileName} - Critical CSS inlined`);
        }

        console.log('✅ All HTML files processed successfully!\n');
      } catch (error) {
        console.error('❌ Failed to extract critical CSS:', error.message);
        console.error(error.stack);
        // Don't throw - allow build to continue
      }
    }
  };
}
