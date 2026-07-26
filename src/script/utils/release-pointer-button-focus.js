const BUTTON_SELECTOR = 'button, [role="button"]';

/**
 * Release focus after a button is activated with a pointer.
 *
 * Browsers keep a clicked button focused, so a later Space/Enter press can
 * activate that same button again. Keyboard-originated and programmatic clicks
 * have `detail === 0`; leaving those alone preserves normal keyboard access.
 */
export function releasePointerButtonFocus(root = document) {
  const onClick = (event) => {
    if (event.detail === 0) return;

    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest(BUTTON_SELECTOR);
    button?.blur();
  };

  root.addEventListener('click', onClick, true);
  return () => root.removeEventListener('click', onClick, true);
}
