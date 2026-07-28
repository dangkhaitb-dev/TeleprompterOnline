/* @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import { parseWorkspaceJson, sanitizeWorkspaceHtml } from './workspace-json.js';

describe('workspace JSON upload helpers', () => {
  it('parses the versioned workspace export shape', () => {
    const result = parseWorkspaceJson(JSON.stringify({
      format: 'solprompter-workspace',
      schemaVersion: 1,
      workspace: {
        title: 'Demo',
        scriptText: 'Hello',
        scriptHtml: '<p>Hello</p>',
        settings: { wpm: 140 },
      },
    }));

    expect(result).toEqual({
      title: 'Demo',
      scriptText: 'Hello',
      scriptHtml: '<p>Hello</p>',
      settings: { wpm: 140 },
    });
  });

  it('rejects unrelated and empty JSON documents', () => {
    expect(() => parseWorkspaceJson('{"hello":"world"}')).toThrow('Unsupported');
    expect(() => parseWorkspaceJson(JSON.stringify({
      format: 'solprompter-workspace',
      schemaVersion: 1,
      workspace: {},
    }))).toThrow('empty');
  });

  it('keeps formatting while removing executable HTML', () => {
    const result = sanitizeWorkspaceHtml(
      '<p onclick="alert(1)" style="font-size: 42px; background-image: url(x)">'
      + '<strong>Hello</strong><script>alert(1)</script><img src=x onerror=alert(1)></p>',
    );

    expect(result).toContain('<strong>Hello</strong>');
    expect(result).toContain('font-size: 42px');
    expect(result).not.toMatch(/onclick|background-image|script|img|onerror/i);
  });
});
