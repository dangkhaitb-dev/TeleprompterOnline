// workspace-json.js — parse and sanitize portable workspace JSON uploads.

const ALLOWED_TAGS = new Set([
  'B', 'BLOCKQUOTE', 'BR', 'DIV', 'EM', 'FONT', 'I', 'LI', 'OL', 'P',
  'S', 'SPAN', 'STRIKE', 'STRONG', 'U', 'UL',
]);
const ALLOWED_STYLES = new Set([
  'color', 'background-color', 'font-size', 'font-style',
  'font-weight', 'text-align', 'text-decoration', 'text-decoration-line',
]);
const BLOCKED_CONTENT_TAGS = new Set([
  'EMBED', 'IFRAME', 'MATH', 'NOSCRIPT', 'OBJECT', 'SCRIPT', 'STYLE', 'SVG', 'TEMPLATE',
]);

export function parseWorkspaceJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || ''));
  } catch {
    throw new Error('Invalid JSON file');
  }
  const workspace = parsed?.workspace;
  if (parsed?.format !== 'vteleprompter-workspace' || !workspace || typeof workspace !== 'object') {
    throw new Error('Unsupported workspace JSON');
  }
  if (parsed.schemaVersion !== 1) throw new Error('Unsupported workspace version');
  const scriptText = typeof workspace.scriptText === 'string' ? workspace.scriptText : '';
  const scriptHtml = typeof workspace.scriptHtml === 'string' ? workspace.scriptHtml : '';
  if (!scriptText.trim() && !scriptHtml.trim()) throw new Error('Workspace is empty');
  return {
    title: typeof workspace.title === 'string' ? workspace.title : '',
    scriptText,
    scriptHtml,
    settings: workspace.settings && typeof workspace.settings === 'object'
      ? workspace.settings
      : {},
  };
}

export function sanitizeWorkspaceHtml(html, parser = globalThis.DOMParser) {
  if (!html || !parser) return '';
  const document = new parser().parseFromString(`<body>${html}</body>`, 'text/html');
  const elements = [...document.body.querySelectorAll('*')];
  elements.forEach((element) => {
    if (!ALLOWED_TAGS.has(element.tagName)) {
      if (BLOCKED_CONTENT_TAGS.has(element.tagName)) element.remove();
      else element.replaceWith(...element.childNodes);
      return;
    }
    [...element.attributes].forEach((attribute) => {
      if (attribute.name !== 'style'
        && !(element.tagName === 'FONT' && ['color', 'face', 'size'].includes(attribute.name))) {
        element.removeAttribute(attribute.name);
      }
    });
    if (element.hasAttribute('style')) {
      const properties = Array.from(
        { length: element.style.length },
        (_, index) => element.style.item(index),
      );
      const safeStyle = properties
        .filter((property) => ALLOWED_STYLES.has(property))
        .map((property) => `${property}: ${element.style.getPropertyValue(property)}`)
        .join('; ');
      if (safeStyle) element.setAttribute('style', safeStyle);
      else element.removeAttribute('style');
    }
  });
  return document.body.innerHTML;
}
