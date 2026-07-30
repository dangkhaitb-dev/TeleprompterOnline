import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertTestNoindexOutput,
  createTestPreviewOptions,
  forceTestNoindex,
  testNoindexPlugin,
} from '../../vite-plugin-test-noindex.js';

const NOINDEX_META = '<meta name="robots" content="noindex, nofollow">';

describe('forceTestNoindex', () => {
  it('replaces an indexable robots directive with one canonical noindex directive', () => {
    const html = '<html><head><meta name="robots" content="index, follow"></head></html>';

    const transformed = forceTestNoindex(html);

    expect(transformed).toContain(NOINDEX_META);
    expect(transformed).not.toContain('content="index, follow"');
    expect(transformed.match(/<meta\b[^>]*\bname=["']robots["'][^>]*>/gi)).toHaveLength(1);
  });

  it('deduplicates existing robots tags regardless of attribute order and quote style', () => {
    const html = [
      '<html><head>',
      "<meta content='index, follow' name='robots'>",
      '<meta content="noindex" data-source="old" name="robots">',
      '</head></html>',
    ].join('');

    const transformed = forceTestNoindex(html);

    expect(transformed.match(/<meta\b[^>]*\bname=["']robots["'][^>]*>/gi)).toHaveLength(1);
    expect(transformed).toContain(NOINDEX_META);
  });

  it('inserts the directive when the document has no robots tag', () => {
    const transformed = forceTestNoindex('<html><head><title>Test</title></head></html>');

    expect(transformed).toContain(`<head>\n    ${NOINDEX_META}`);
  });

  it('preserves unrelated meta attributes whose names merely end in name', () => {
    const html = '<html><head><meta data-name="robots" content="analytics"></head></html>';

    const transformed = forceTestNoindex(html);

    expect(transformed).toContain('<meta data-name="robots" content="analytics">');
    expect(transformed).toContain(NOINDEX_META);
  });

  it('fails the build when an HTML entry has no head element', () => {
    expect(() => forceTestNoindex('<main>Missing head</main>'))
      .toThrow(/head element/i);
  });
});

describe('createTestPreviewOptions', () => {
  it('does not add test headers or allowed hosts outside test mode', () => {
    expect(createTestPreviewOptions({ enabled: false })).toEqual({});
  });

  it('adds noindex headers and only the ngrok host suffixes in test mode', () => {
    expect(createTestPreviewOptions({ enabled: true })).toEqual({
      host: '127.0.0.1',
      allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev'],
      headers: {
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  });
});

describe('package build commands', () => {
  it('uses explicit test mode only in the test build and preview commands', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    );

    expect(packageJson.scripts['build:test']).toMatch(/vite build --mode test$/);
    expect(packageJson.scripts['preview:test']).toMatch(/vite preview --mode test\b/);
    expect(packageJson.scripts.build).not.toContain('--mode test');
    expect(packageJson.scripts.preview).not.toContain('--mode test');
  });
});

describe('assertTestNoindexOutput', () => {
  it('rejects a test build when any nested HTML file is still indexable', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'solprompter-test-noindex-'));
    const nestedDirectory = join(outputDirectory, 'vi');

    try {
      await mkdir(nestedDirectory);
      await writeFile(
        join(outputDirectory, 'index.html'),
        `<html><head>${NOINDEX_META}</head></html>`,
      );
      await writeFile(
        join(nestedDirectory, 'index.html'),
        '<html><head><meta name="robots" content="index, follow"></head></html>',
      );

      await expect(assertTestNoindexOutput(outputDirectory))
        .rejects.toThrow(/vi\/index\.html/);
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });
});

describe('testNoindexPlugin', () => {
  it('leaves production HTML unchanged when the plugin is disabled', () => {
    const html = '<html><head><meta name="robots" content="index, follow"></head></html>';
    const plugin = testNoindexPlugin({ enabled: false });

    expect(plugin.transformIndexHtml.handler(html)).toBe(html);
  });

  it('forces noindex when the plugin is enabled', () => {
    const plugin = testNoindexPlugin({ enabled: true });

    expect(plugin.transformIndexHtml.handler('<html><head></head></html>'))
      .toContain(NOINDEX_META);
  });

  it('validates final output in a sequential post-build hook', () => {
    const plugin = testNoindexPlugin({ enabled: true });

    expect(plugin.closeBundle).toMatchObject({
      order: 'post',
      sequential: true,
      handler: expect.any(Function),
    });
  });
});
