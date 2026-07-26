import { describe, it, expect } from 'vitest';
import { snapshotWorkspace, isStale } from './stale-detector.js';

const ws = (over = {}) => ({
  id: 'ws1',
  title: 'A',
  scriptHtml: '<p>hello</p>',
  scriptText: 'hello',
  settings: { wpm: 120, align: 'left', bold: false },
  updatedAt: 1,
  ...over,
});

describe('snapshotWorkspace', () => {
  it('is equal for two workspaces with the same script + settings', () => {
    expect(snapshotWorkspace(ws())).toBe(snapshotWorkspace(ws()));
  });

  it('ignores non-script fields (title/updatedAt/folderId)', () => {
    expect(snapshotWorkspace(ws())).toBe(
      snapshotWorkspace(ws({ title: 'B', updatedAt: 999, folderId: 'x' })),
    );
  });

  it('ignores settings entirely (content-only scope)', () => {
    const a = ws({ settings: { align: 'left', bold: false, wpm: 120 } });
    const b = ws({ settings: { wpm: 200, align: 'right', bold: true } });
    expect(snapshotWorkspace(a)).toBe(snapshotWorkspace(b));
  });

  it('tolerates missing/empty fields', () => {
    expect(() => snapshotWorkspace(undefined)).not.toThrow();
    expect(snapshotWorkspace({})).toBe(snapshotWorkspace({ scriptHtml: '', settings: {} }));
  });
});

describe('isStale', () => {
  it('is false when content and settings match', () => {
    expect(isStale(ws(), ws())).toBe(false);
  });

  it('is true when the script body changed', () => {
    expect(isStale(ws(), ws({ scriptHtml: '<p>changed</p>' }))).toBe(true);
  });

  it('is false when only a setting changed (settings are out of scope)', () => {
    expect(isStale(ws(), ws({ settings: { wpm: 200, align: 'right', bold: true } }))).toBe(false);
  });

  it('is true when the inline style of the content changed', () => {
    expect(isStale(ws(), ws({ scriptHtml: '<p><b>hello</b></p>' }))).toBe(true);
  });

  it('accepts a precomputed baseline snapshot string', () => {
    const baseline = snapshotWorkspace(ws());
    expect(isStale(baseline, ws())).toBe(false);
    expect(isStale(baseline, ws({ scriptText: 'other', scriptHtml: '<p>other</p>' }))).toBe(true);
  });
});
