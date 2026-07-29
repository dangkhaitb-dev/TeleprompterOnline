import { describe, expect, it } from 'vitest';
import configureEleventy from '../../eleventy.config.cjs';

const { allocateUniqueId } = configureEleventy;

describe('Eleventy article heading IDs', () => {
  it('avoids suffix collisions and fixed page IDs', () => {
    const allocatedIds = new Set(['article-content', 'article-toc-title']);

    const ids = [
      allocateUniqueId('foo', allocatedIds),
      allocateUniqueId('foo', allocatedIds),
      allocateUniqueId('foo-2', allocatedIds),
      allocateUniqueId('article-content', allocatedIds),
      allocateUniqueId('article-toc-title', allocatedIds),
    ];

    expect(ids).toEqual([
      'foo',
      'foo-2',
      'foo-2-2',
      'article-content-2',
      'article-toc-title-2',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
