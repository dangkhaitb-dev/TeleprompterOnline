import { describe, expect, it, vi } from 'vitest';
import { createVoiceLanguagePreflight } from './voice-language-preflight.js';

describe('createVoiceLanguagePreflight', () => {
  it.each(['wpm', 'time'])(
    'keeps background preparation active without preparing %s Play or Record actions',
    async (mode) => {
      const prepare = vi.fn(() => Promise.resolve({ status: 'ready' }));
      const preflight = createVoiceLanguagePreflight({
        getScrollMode: () => mode,
        prepare,
      });

      await expect(preflight.prepareInBackground({ reason: 'studio-init' }))
        .resolves.toEqual({ status: 'ready' });
      expect(preflight.prepareForAction({ reason: 'play' })).toBeNull();
      expect(preflight.prepareForAction({ reason: 'record' })).toBeNull();
      expect(prepare).toHaveBeenCalledOnce();
      expect(prepare).toHaveBeenCalledWith({ reason: 'studio-init' });
    },
  );

  it.each(['play', 'record'])(
    'forces language preparation for an Auto Scroll %s action',
    async (reason) => {
      const prepare = vi.fn(() => Promise.resolve({ status: 'ready' }));
      const preflight = createVoiceLanguagePreflight({
        getScrollMode: () => 'auto',
        prepare,
      });

      await expect(preflight.prepareForAction({ reason }))
        .resolves.toEqual({ status: 'ready' });
      expect(prepare).toHaveBeenCalledWith({ reason, force: true });
    },
  );
});
