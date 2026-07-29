// Keeps background language-model preparation independent from the selected
// reading mode, while reserving action-time checks for voice-driven scrolling.

export function createVoiceLanguagePreflight({ getScrollMode, prepare } = {}) {
  function prepareInBackground(options) {
    return prepare ? prepare(options) : Promise.resolve(null);
  }

  function prepareForAction(options) {
    if (!prepare || getScrollMode?.() !== 'auto') return null;
    return prepare({ ...options, force: true });
  }

  return { prepareInBackground, prepareForAction };
}
