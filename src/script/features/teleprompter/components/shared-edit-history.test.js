import { describe, expect, it } from 'vitest';
import { createSharedEditHistory } from './shared-edit-history.js';

describe('createSharedEditHistory', () => {
  it('uses one timeline for content and shared formatting settings', async () => {
    const history = createSharedEditHistory({ html: 'one', align: 'left', fontSize: '20' });

    history.commit({ html: 'two', align: 'left' });
    history.commit({ html: 'two', align: 'center', bold: true });

    expect((await history.undo()).align).toBe('left');
    expect((await history.undo()).html).toBe('one');
    expect((await history.redo()).html).toBe('two');
  });

  it('drops redo states after a new edit and ignores duplicate snapshots', async () => {
    const history = createSharedEditHistory({ html: 'a', align: 'left' });
    history.commit({ html: 'b', align: 'left' });
    history.commit({ html: 'b', align: 'left' });
    await history.undo();
    history.commit({ html: 'c', align: 'right' });

    expect(await history.redo()).toBeNull();
    expect((await history.undo()).html).toBe('a');
  });

  it('applies font, line height, color and BIU snapshots through library commands', async () => {
    const applied = [];
    const history = createSharedEditHistory(
      { html: 'text', align: 'left' },
      { onApply: (state) => applied.push(state) },
    );
    history.commit({
      html: 'text', align: 'left', fontSize: '32', lineHeight: '1.5',
      color: '#ffffff', bold: true, italic: true, underline: true,
    });

    const undone = await history.undo();
    const redone = await history.redo();
    expect(undone.bold).toBe(false);
    expect(redone).toMatchObject({
      fontSize: '32', lineHeight: '1.5', color: '#ffffff',
      bold: true, italic: true, underline: true,
    });
    expect(applied).toHaveLength(2);
  });
});
