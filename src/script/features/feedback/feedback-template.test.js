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

describe('feedback template coverage', () => {
  it.each(eligibleLayouts)('includes the widget in %s', (layout) => {
    expect(readInclude(layout)).toContain('{% include "partials/feedback-widget.njk" %}');
  });

  it('keeps the feedback widget out of the teleprompter layout', () => {
    expect(readInclude('teleprompter-base.njk')).not.toContain('feedback-widget');
  });

  it('loads the shared module and exposes the required form fields', () => {
    const partial = readInclude('partials/feedback-widget.njk');

    expect(partial).toContain('src="/src/script/feedback-main.js"');
    expect(partial).toContain('name="email"');
    expect(partial).toContain('maxlength="254"');
    expect(partial).toContain('name="content"');
    expect(partial).toContain('minlength="3"');
    expect(partial).toContain('maxlength="5000"');
  });
});
