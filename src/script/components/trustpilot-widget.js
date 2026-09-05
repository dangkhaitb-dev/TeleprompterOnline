// trustpilot-widget.js — re-hydrates Trustpilot widgets added after the
// bootstrap script's initial DOM scan (for example, the post-record editor).

const TRUSTPILOT_SCRIPT_URL = 'https://widget.trustpilot.com/bootstrap/v5/tp.widget.bootstrap.min.js';
let bootstrapPromise = null;

function getTrustpilotApi() {
  return typeof window !== 'undefined' ? window.Trustpilot : null;
}

function loadBootstrapScript(doc) {
  const existing = Array.from(doc.scripts).find((script) => (
    script.src === TRUSTPILOT_SCRIPT_URL
    || script.src === `${TRUSTPILOT_SCRIPT_URL}/`
  ));

  if (existing) {
    return new Promise((resolve) => {
      if (getTrustpilotApi()?.loadFromElement) {
        resolve();
        return;
      }
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', resolve, { once: true });
    });
  }

  return new Promise((resolve) => {
    const script = doc.createElement('script');
    script.type = 'text/javascript';
    // Trustpilot only installs its MutationObserver when this flag is present
    // on the bootstrap element. The post-record editor mounts after the page
    // has already been parsed, so opt into that dynamic lifecycle explicitly.
    script.dataset.dynamic = 'true';
    script.src = TRUSTPILOT_SCRIPT_URL;
    script.async = true;
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', resolve, { once: true });
    (doc.head || doc.body || doc.documentElement).append(script);
  });
}

function hydrateWidget(widget) {
  if (!widget || widget.querySelector('iframe')) return true;
  const api = getTrustpilotApi();
  if (typeof api?.loadFromElement !== 'function') return false;
  try {
    // Keep the Trustpilot object as the call receiver. Its public method uses
    // `this.Modules` internally, so extracting the function would make the
    // dynamic hydration fail and leave only the fallback link visible.
    api.loadFromElement(widget);
    // `loadFromElement` creates the iframe synchronously for this TrustBox.
    // Keep retrying when the bootstrap has not finished wiring its modules yet
    // instead of treating the plain fallback link as a successful init.
    return Boolean(widget.querySelector('iframe'));
  } catch {
    // Keep the fallback Trustpilot link usable if the vendor loader rejects.
    return false;
  }
}

export function initTrustpilotWidget(widget) {
  if (!widget) return Promise.resolve();
  const doc = widget.ownerDocument || document;
  const api = getTrustpilotApi();
  if (typeof api?.loadFromElement === 'function') {
    hydrateWidget(widget);
    return Promise.resolve();
  }

  if (!bootstrapPromise) bootstrapPromise = loadBootstrapScript(doc);
  return bootstrapPromise.then(() => {
    if (hydrateWidget(widget)) return;
    // The bootstrap's public API can be exposed one tick before its internal
    // WidgetManagement module is ready. Retry once after that microtask turn.
    setTimeout(() => hydrateWidget(widget), 0);
  });
}
