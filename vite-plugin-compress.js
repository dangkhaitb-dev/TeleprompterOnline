/**
 * Vite Plugin: pre-compress text assets to .br + .gz at build time.
 *
 * Hashed, immutable assets are built once and served millions of times, so we
 * compress them once at maximum quality (brotli 11 / gzip 9) and let nginx serve
 * the pre-made file via `brotli_static on;` / `gzip_static on;` — best ratio,
 * zero per-request CPU. Uses Node's built-in zlib, so there is no new dependency.
 *
 * Runs last (closeBundle) so it compresses the FINAL HTML, i.e. after the
 * critical-CSS plugin has rewritten it.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { gzipSync, brotliCompressSync, constants } from 'zlib';

// Text assets worth compressing. Binary media (png/jpg/webp/avif/woff2) is
// already compressed, so we skip it.
const COMPRESSIBLE = /\.(?:js|mjs|css|html|svg|json|xml|txt|ico|webmanifest|map)$/;
const MIN_BYTES = 1024; // below this the compressed sibling rarely helps

export default function compressAssets({ minBytes = MIN_BYTES } = {}) {
  return {
    name: 'vite-plugin-compress',
    apply: 'build',

    async closeBundle() {
      const distPath = resolve(process.cwd(), 'dist');
      if (!existsSync(distPath)) return;

      let count = 0;
      let savedGz = 0;
      let savedBr = 0;

      const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
            continue;
          }
          if (!COMPRESSIBLE.test(entry.name)) continue;
          if (entry.name.endsWith('.gz') || entry.name.endsWith('.br')) continue;

          const buf = readFileSync(full);
          if (buf.length < minBytes) continue;

          const gz = gzipSync(buf, { level: 9 });
          const br = brotliCompressSync(buf, {
            params: {
              [constants.BROTLI_PARAM_QUALITY]: 11,
              [constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
            },
          });
          writeFileSync(`${full}.gz`, gz);
          writeFileSync(`${full}.br`, br);
          count += 1;
          savedGz += buf.length - gz.length;
          savedBr += buf.length - br.length;
        }
      };

      walk(distPath);
      const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
      console.log(
        `\n🗜️  Pre-compressed ${count} assets — saved ${kb(savedGz)} (gzip), ${kb(savedBr)} (brotli)`,
      );
    },
  };
}
