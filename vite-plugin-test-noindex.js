import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_ROBOTS_META = '<meta name="robots" content="noindex, nofollow">';
const META_TAG_PATTERN = /<meta\b[^>]*>/gi;
const ROBOTS_NAME_PATTERN = /(?:^|\s)name\s*=\s*(?:"robots"|'robots'|robots)(?=\s|\/?>)/i;
const HEAD_OPEN_PATTERN = /<head\b[^>]*>/i;
const CONTENT_ATTRIBUTE_PATTERN = /(?:^|\s)content\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

const TEST_PREVIEW_ALLOWED_HOSTS = ['.ngrok-free.app', '.ngrok-free.dev'];

export function createTestPreviewOptions({ enabled = false } = {}) {
  if (!enabled) return {};

  return {
    host: '127.0.0.1',
    allowedHosts: [...TEST_PREVIEW_ALLOWED_HOSTS],
    headers: {
      'X-Robots-Tag': 'noindex, nofollow',
    },
  };
}

export function forceTestNoindex(html) {
  const withoutRobotsMeta = html.replace(
    META_TAG_PATTERN,
    (tag) => ROBOTS_NAME_PATTERN.test(tag) ? '' : tag,
  );

  if (!HEAD_OPEN_PATTERN.test(withoutRobotsMeta)) {
    throw new Error('[test-noindex] Cannot inject robots metadata: HTML entry has no head element.');
  }

  return withoutRobotsMeta.replace(
    HEAD_OPEN_PATTERN,
    (head) => `${head}\n    ${TEST_ROBOTS_META}`,
  );
}

async function listHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const htmlFiles = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      htmlFiles.push(...await listHtmlFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      htmlFiles.push(entryPath);
    }
  }

  return htmlFiles;
}

export async function assertTestNoindexOutput(outputDirectory) {
  const htmlFiles = await listHtmlFiles(outputDirectory);

  if (htmlFiles.length === 0) {
    throw new Error(`[test-noindex] No HTML files found in ${outputDirectory}.`);
  }

  const unsafeFiles = [];

  for (const file of htmlFiles) {
    const html = await readFile(file, 'utf8');
    const robotsTags = (html.match(META_TAG_PATTERN) ?? [])
      .filter((tag) => ROBOTS_NAME_PATTERN.test(tag));
    const contentMatch = robotsTags[0]?.match(CONTENT_ATTRIBUTE_PATTERN);
    const directives = (contentMatch?.[1] ?? contentMatch?.[2] ?? contentMatch?.[3] ?? '')
      .split(',')
      .map((directive) => directive.trim().toLowerCase());

    if (robotsTags.length !== 1 || !directives.includes('noindex') || !directives.includes('nofollow')) {
      unsafeFiles.push(file);
    }
  }

  if (unsafeFiles.length > 0) {
    throw new Error(`[test-noindex] Unsafe HTML output: ${unsafeFiles.join(', ')}`);
  }
}

export function testNoindexPlugin({ enabled = false } = {}) {
  let outputDirectory = 'dist';

  return {
    name: 'solprompter-test-noindex',
    apply: 'build',
    configResolved(config) {
      outputDirectory = config.build.outDir;
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return enabled ? forceTestNoindex(html) : html;
      },
    },
    closeBundle: {
      order: 'post',
      sequential: true,
      async handler() {
        if (enabled) await assertTestNoindexOutput(outputDirectory);
      },
    },
  };
}
