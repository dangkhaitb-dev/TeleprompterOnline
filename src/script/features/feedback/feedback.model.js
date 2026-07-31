const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const IPV6_HOST_PATTERN = /^\[[0-9a-f:]+\]$/i;
const MAX_EMAIL_LENGTH = 254;
const MAX_DOMAIN_LENGTH = 253;
const MIN_CONTENT_LENGTH = 3;
const MAX_CONTENT_LENGTH = 5000;

export class FeedbackValidationError extends Error {
  constructor(field, code) {
    super(`Invalid feedback ${field}: ${code}`);
    this.name = 'FeedbackValidationError';
    this.field = field;
    this.code = code;
  }
}

function trimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidDomain(domain) {
  if (domain.length > MAX_DOMAIN_LENGTH) return false;
  if (IPV6_HOST_PATTERN.test(domain)) return true;
  return domain.split('.').every((label) => (
    label.length > 0
    && label.length <= 63
    && DOMAIN_LABEL_PATTERN.test(label)
  ));
}

export function toFeedback(raw = {}) {
  const email = trimmedString(raw.email);
  const content = trimmedString(raw.content);
  const domain = trimmedString(raw.domain);

  if (email) {
    if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
      throw new FeedbackValidationError('email', 'invalid');
    }
  }
  if (!content) throw new FeedbackValidationError('content', 'required');
  if (content.length < MIN_CONTENT_LENGTH) {
    throw new FeedbackValidationError('content', 'too_short');
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new FeedbackValidationError('content', 'too_long');
  }
  if (!domain) throw new FeedbackValidationError('domain', 'required');
  if (!isValidDomain(domain)) {
    throw new FeedbackValidationError('domain', 'invalid');
  }

  return { email, content, domain };
}
