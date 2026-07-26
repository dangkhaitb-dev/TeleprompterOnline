/**
 * Vite Plugin: Auto-inject modulepreload for critical JS modules
 *
 * WHY: Eliminate waterfall effect for critical JS
 * - main.js loads → discovers downloader-ui.js → downloads (SLOW)
 * - With modulepreload: main.js + downloader-ui.js download PARALLEL (FAST ~200-300ms)
 *
 * HOW: Inject <link rel="modulepreload"> into HTML during build
 * - Only for critical modules (downloader-ui, state, ui-renderer, etc.)
 * - Auto-detects hashed filenames in build output
 */

export default function modulePreloadPlugin() {
  return {
    name: 'vite-plugin-modulepreload',
    enforce: 'post', // Run after other plugins

    transformIndexHtml: {
      order: 'post',
      handler(html, { bundle }) {
        if (!bundle) return html; // Skip in dev mode

        // Find critical JS modules in bundle
        const criticalModules = [];

        // Critical module patterns to preload
        // NOTE: editor.ui is NOT included - it's lazy-loaded via preloadEditor()
        // which already handles slow connections and mobile vs desktop
        const criticalPatterns = [
          'downloader-ui',
          'state',
          'ui-renderer',
          'input-form'
        ];

        for (const [fileName, chunk] of Object.entries(bundle)) {
          if (chunk.type === 'chunk') {
            // Check if this chunk matches any critical pattern
            if (criticalPatterns.some(pattern => fileName.includes(pattern))) {
              criticalModules.push(fileName);
            }
          }
        }

        if (criticalModules.length === 0) return html;

        // Generate modulepreload tags
        const modulepreloadTags = criticalModules.map(file =>
          `<link rel="modulepreload" href="/${file}" as="script" crossorigin>`
        ).join('\n    ');

        // Insert after font preload (simple string replacement)
        const fontPreloadPattern = /<link rel="preload" href="\/fonts\/[^"]+\.(woff2|ttf)" as="font"[^>]*>/;
        const match = html.match(fontPreloadPattern);

        if (match) {
          // Insert after font preload
          return html.replace(
            match[0],
            match[0] + '\n    <!-- Critical JS Module Preload -->\n    ' + modulepreloadTags
          );
        } else {
          // Fallback: Insert before </head>
          return html.replace(
            '</head>',
            `    <!-- Critical JS Module Preload -->\n    ${modulepreloadTags}\n</head>`
          );
        }
      }
    }
  };
}
