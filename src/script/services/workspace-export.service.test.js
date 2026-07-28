import { describe, expect, it } from 'vitest';
import {
  buildSelectedWorkspaceEntries,
  buildWorkspaceExportPayload,
} from './workspace-export.service.js';

describe('workspace export service', () => {
  const workspace = {
    id: 'ws_one',
    title: 'Demo',
    scriptText: 'Hello',
    scriptHtml: '<p><strong>Hello</strong></p>',
    folderId: 'folder_one',
    settings: { wpm: 145, mirror: true },
    createdAt: 10,
    updatedAt: 20,
  };

  it('keeps content and per-script settings in a JSON payload', () => {
    const payload = buildWorkspaceExportPayload(workspace, 0);

    expect(payload.format).toBe('solprompter-workspace');
    expect(payload.schemaVersion).toBe(1);
    expect(payload.workspace).toMatchObject({
      scriptText: 'Hello',
      scriptHtml: '<p><strong>Hello</strong></p>',
      settings: { wpm: 145, mirror: true },
    });
  });

  it('creates only JSON files for selected scripts and names them by title', async () => {
    const entries = buildSelectedWorkspaceEntries([
      { ...workspace, id: 'selected' },
      { ...workspace, id: 'second', title: 'Demo' },
      { ...workspace, id: 'ignored', title: 'Ignored' },
    ], ['selected', 'second'], 0);

    expect(entries.map((entry) => entry.name)).toEqual(['Demo.json', 'Demo (2).json']);
    expect(JSON.parse(await entries[0].blob.text()).workspace.id).toBe('selected');
  });
});
