import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const includesDirectory = new URL('../../../../_templates/_includes/', import.meta.url);
const eligibleLayouts = [
  'base.njk',
  'home-base.njk',
  'workspaces-base.njk',
  'blog-base.njk',
  'blog-article-base.njk',
  'simple-page-base.njk',
  'error-base.njk',
];

function readInclude(filename) {
  return readFileSync(new URL(filename, includesDirectory), 'utf8');
}

describe('support widget template coverage', () => {
  it.each(eligibleLayouts)('includes the widget in %s', (layout) => {
    expect(readInclude(layout)).toContain('{% include "partials/support-widget.njk" %}');
  });

  it('keeps the support widget out of the teleprompter layout', () => {
    expect(readInclude('teleprompter-base.njk')).not.toContain('support-widget');
  });

  it('loads the shared support module', () => {
    const partial = readInclude('partials/support-widget.njk');

    expect(partial).toContain('src="/src/script/support-main.js"');
  });
});
