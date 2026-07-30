const BUTTON_SELECTOR = [
  'button',
  '[role="button"]',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
].join(', ');
const CHANGE_CONTROL_SELECTOR = [
  'input[data-analytics-name]',
  'select[data-analytics-name]',
  'textarea[data-analytics-name]',
].join(', ');

const FIREBASE_EVENT_NAME_LIMIT = 40;
const EVENT_PARAM_VALUE_LIMIT = 100;
const DYNAMIC_CLASS_NAMES = new Set([
  'active',
  'danger',
  'disabled',
  'hidden',
  'is-active',
  'is-disabled',
  'is-loading',
  'open',
  'primary',
  'secondary',
  'selected',
]);

let analyticsClientPromise;

function clip(value, limit = EVENT_PARAM_VALUE_LIMIT) {
  return String(value || '').slice(0, limit);
}

/**
 * Convert UI identifiers into stable, readable analytics segments.
 * Hyphens are kept here so the requested base name remains page-button.
 */
export function toAnalyticsSegment(value, fallback = '') {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/(^|-)button(?=-|$)/g, '$1btn');

  return normalized || fallback;
}

export function toActionName(value, fallback = 'btn') {
  const words = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return fallback;

  const actionName = words
    .map((word, index) => {
      const compact = word.replace(/button/gi, (match) => (
        match[0] === 'B' ? 'Btn' : 'btn'
      ));
      if (index === 0) return compact.charAt(0).toLowerCase() + compact.slice(1);
      return compact.charAt(0).toUpperCase() + compact.slice(1);
    })
    .join('');

  return /^[a-z]/.test(actionName) ? actionName : `action${actionName}`;
}

function shortHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, '0').slice(-7);
}

/**
 * Firebase/GA4 event names only accept letters, numbers and underscores and
 * are limited to 40 characters. Keep the requested hyphenated name in the
 * event_base parameter, and send this compatible form as the actual event.
 */
export function toFirebaseEventName(baseName) {
  let eventName = String(baseName || 'btn-click')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/button/gi, (match) => (match[0] === 'B' ? 'Btn' : 'btn'))
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
  if (!/^[a-zA-Z]/.test(eventName) || /^(firebase|google|ga)_/i.test(eventName)) {
    eventName = `app_${eventName}`;
  }

  if (eventName.length <= FIREBASE_EVENT_NAME_LIMIT) return eventName;

  const suffix = shortHash(eventName);
  return `${eventName.slice(0, FIREBASE_EVENT_NAME_LIMIT - suffix.length - 1)}_${suffix}`;
}

export function getPageAnalyticsName(doc = document, pageLocation = window.location) {
  const explicitName = doc.body?.dataset.analyticsPage;
  if (explicitName) return toAnalyticsSegment(explicitName, 'page');

  const path = decodeURIComponent(pageLocation?.pathname || '/')
    .replace(/\/index\.html$/i, '/')
    .replace(/\.html$/i, '')
    .replace(/^\/pages\//i, '/')
    .replace(/^\/+|\/+$/g, '');
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 0) return 'home';

  const documentLanguage = toAnalyticsSegment(doc.documentElement?.lang);
  if (segments.length === 1 && documentLanguage === toAnalyticsSegment(segments[0])) {
    return 'home';
  }

  if (segments[0] === 'blog' && segments[1]) {
    return toAnalyticsSegment(`blog-${segments.at(-1)}`, 'blog-article');
  }

  return toAnalyticsSegment(segments.at(-1), 'home');
}

function getSemanticDataName(button) {
  const keys = ['action', 'role', 'cmd', 'view', 'toggle', 'tab', 'align'];
  for (const key of keys) {
    const value = button.dataset?.[key];
    if (value) return `${key}-${value}`;
  }
  return '';
}

function getStableClassName(button) {
  return [...(button.classList || [])].find((className) => (
    className
    && !DYNAMIC_CLASS_NAMES.has(className)
    && !className.startsWith('is-')
    && !className.startsWith('has-')
  )) || '';
}

export function getButtonAnalyticsName(button, actionTarget = button) {
  const explicitControl = actionTarget?.closest?.('[data-analytics-name]');
  const explicitName = button.contains?.(explicitControl)
    ? explicitControl.dataset.analyticsName
    : button.dataset?.analyticsName;
  if (explicitName) return toActionName(explicitName);

  if (button.id) return toAnalyticsSegment(button.id, 'btn');

  const semanticDataName = getSemanticDataName(button);
  if (semanticDataName) return toAnalyticsSegment(semanticDataName, 'btn');

  const stableClassName = getStableClassName(button);
  if (stableClassName) return toAnalyticsSegment(stableClassName, 'btn');

  const accessibleName = button.getAttribute?.('aria-label') || button.getAttribute?.('title');
  if (accessibleName) return toAnalyticsSegment(accessibleName, 'btn');

  const inputName = button.getAttribute?.('name') || button.getAttribute?.('type');
  return toAnalyticsSegment(inputName, 'btn');
}

export function buildButtonClickEvent(button, {
  doc = document,
  pageLocation = window.location,
  pageName,
  actionTarget = button,
} = {}) {
  const contextPage = button.closest?.('[data-analytics-page]')?.dataset.analyticsPage;
  const resolvedPageName = toAnalyticsSegment(
    contextPage || pageName || getPageAnalyticsName(doc, pageLocation),
    'page',
  );
  const buttonName = getButtonAnalyticsName(button, actionTarget);
  const eventBase = `${resolvedPageName}-${buttonName}`;

  return {
    name: toFirebaseEventName(eventBase),
    params: {
      event_base: clip(eventBase),
      page_name: clip(resolvedPageName),
      action_name: clip(buttonName),
      button_name: clip(buttonName),
      page_path: clip(pageLocation?.pathname || '/'),
    },
  };
}

export function buildControlChangeEvent(control, options = {}) {
  const analyticsEvent = buildButtonClickEvent(control, {
    ...options,
    actionTarget: control,
  });
  const { button_name: controlName, ...params } = analyticsEvent.params;
  return {
    ...analyticsEvent,
    params: {
      ...params,
      control_name: controlName,
    },
  };
}

async function loadAnalyticsClient() {
  if (!analyticsClientPromise) {
    analyticsClientPromise = Promise.all([
      import('./firebase-init.js'),
      import('firebase/analytics'),
    ])
      .then(async ([{ initializeFirebase }, { logEvent }]) => {
        const initialized = await initializeFirebase();
        if (!initialized?.analytics) return null;
        return { analytics: initialized.analytics, logEvent };
      })
      .catch(() => null);
  }
  return analyticsClientPromise;
}

/**
 * Track every current and future button through one capture-phase listener.
 * Dynamic UI (menus, cards, popups, scene editor) is covered automatically.
 */
export function initButtonClickTracking({
  root = document,
  doc = document,
  pageLocation = window.location,
  pageName,
  loadClient = loadAnalyticsClient,
} = {}) {
  let clientPromise;

  const getClient = () => {
    if (!clientPromise) {
      clientPromise = Promise.resolve().then(() => loadClient()).catch(() => null);
    }
    return clientPromise;
  };

  const send = (analyticsEvent) => {
    void getClient().then((client) => {
      if (!client?.analytics || typeof client.logEvent !== 'function') return;
      client.logEvent(client.analytics, analyticsEvent.name, analyticsEvent.params);
    });
  };

  const onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest(BUTTON_SELECTOR);
    if (!button || (root !== doc && !root.contains(button))) return;
    if (button.hasAttribute('data-analytics-ignore')) return;

    send(buildButtonClickEvent(button, {
      doc,
      pageLocation,
      pageName,
      actionTarget: target,
    }));
  };

  const onChange = (event) => {
    const control = event.target instanceof Element
      ? event.target.closest(CHANGE_CONTROL_SELECTOR)
      : null;
    if (!control || (root !== doc && !root.contains(control))) return;
    send(buildControlChangeEvent(control, { doc, pageLocation, pageName }));
  };

  root.addEventListener('click', onClick, true);
  root.addEventListener('change', onChange, true);
  return () => {
    root.removeEventListener('click', onClick, true);
    root.removeEventListener('change', onChange, true);
  };
}
