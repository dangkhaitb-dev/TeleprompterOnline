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
    script.src = TRUSTPILOT_SCRIPT_URL;
    script.async = true;
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', resolve, { once: true });
    (doc.head || doc.body || doc.documentElement).append(script);
  });
}

function hydrateWidget(widget) {
  if (!widget || widget.dataset.trustpilotInitialized === 'true') return;
  const loader = getTrustpilotApi()?.loadFromElement;
  if (typeof loader !== 'function') return;
  try {
    loader(widget);
    widget.dataset.trustpilotInitialized = 'true';
  } catch {
    // Keep the fallback Trustpilot link usable if the vendor loader rejects.
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
  return bootstrapPromise.then(() => hydrateWidget(widget));
}
