import { submitFeedback } from './feedback.logic.js';
import { FeedbackValidationError } from './feedback.model.js';

const FIELD_MESSAGES = {
  email: {
    required: 'feedbackEmailRequired',
    invalid: 'feedbackEmailInvalid',
  },
  content: {
    required: 'feedbackContentRequired',
    too_short: 'feedbackContentTooShort',
    too_long: 'feedbackContentTooLong',
  },
};

function selectWidgetParts(widget) {
  return {
    opener: widget.querySelector('[data-feedback-open]'),
    dialog: widget.querySelector('[data-feedback-dialog]'),
    closeButton: widget.querySelector('[data-feedback-close]'),
    form: widget.querySelector('[data-feedback-form]'),
    email: widget.querySelector('[name="email"]'),
    content: widget.querySelector('[name="content"]'),
    submitButton: widget.querySelector('[data-feedback-submit]'),
    status: widget.querySelector('[data-feedback-status]'),
    emailError: widget.querySelector('[data-feedback-email-error]'),
    contentError: widget.querySelector('[data-feedback-content-error]'),
  };
}

function hasRequiredParts(parts) {
  return Object.values(parts).every(Boolean);
}

export function initFeedbackUI({
  root = document,
  submit = submitFeedback,
  location = window.location,
} = {}) {
  const widget = root.querySelector('[data-feedback-widget]');
  if (!widget) return () => {};

  const updateVisibility = () => {
    const isTpPage = document.documentElement.classList.contains('tp-page') ||
                     document.body.classList.contains('tp');
    if (isTpPage) {
      widget.style.setProperty('display', 'none', 'important');
    } else {
      widget.style.removeProperty('display');
    }
  };

  updateVisibility();

  const observer = new MutationObserver(updateVisibility);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
  });

  const parts = selectWidgetParts(widget);
  if (!hasRequiredParts(parts)) return () => {};

  const {
    opener,
    dialog,
    closeButton,
    form,
    email,
    content,
    submitButton,
    status,
    emailError,
    contentError,
  } = parts;
  const doc = widget.ownerDocument;
  const defaultSubmitLabel = submitButton.textContent;
  let submitting = false;

  const clearStatus = () => {
    status.hidden = true;
    status.textContent = '';
    delete dialog.dataset.state;
  };

  const clearFieldError = (field) => {
    const input = field === 'email' ? email : content;
    const error = field === 'email' ? emailError : contentError;
    input.removeAttribute('aria-invalid');
    error.hidden = true;
    error.textContent = '';
  };

  const clearErrors = () => {
    clearFieldError('email');
    clearFieldError('content');
  };

  const open = () => {
    clearStatus();
    dialog.hidden = false;
    opener.setAttribute('aria-expanded', 'true');
    email.focus();
  };

  const close = ({ restoreFocus = true } = {}) => {
    if (submitting) return;
    dialog.hidden = true;
    opener.setAttribute('aria-expanded', 'false');
    if (restoreFocus) opener.focus();
  };

  const showFieldError = (error) => {
    const input = error.field === 'email' ? email : content;
    const errorElement = error.field === 'email' ? emailError : contentError;
    const messageKey = FIELD_MESSAGES[error.field]?.[error.code];

    if (!messageKey || !input || !errorElement) return false;
    errorElement.textContent = widget.dataset[messageKey] || '';
    errorElement.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return true;
  };

  const setSubmitting = (nextSubmitting) => {
    submitting = nextSubmitting;
    submitButton.disabled = nextSubmitting;
    form.setAttribute('aria-busy', String(nextSubmitting));
    submitButton.textContent = nextSubmitting
      ? widget.dataset.feedbackPending || defaultSubmitLabel
      : defaultSubmitLabel;
  };

  const showStatus = (state, message) => {
    dialog.dataset.state = state;
    status.textContent = message;
    status.hidden = false;
  };

  const onOpen = () => {
    if (dialog.hidden) open();
    else close();
  };
  const onClose = () => close();
  const onKeydown = (event) => {
    if (event.key === 'Escape' && !dialog.hidden) {
      event.preventDefault();
      close();
    }
  };
  const onPointerDown = (event) => {
    if (!dialog.hidden && !widget.contains(event.target)) {
      close({ restoreFocus: false });
    }
  };
  const onEmailInput = () => {
    clearFieldError('email');
    clearStatus();
  };
  const onContentInput = () => {
    clearFieldError('content');
    clearStatus();
  };
  const onSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    clearErrors();
    clearStatus();
    setSubmitting(true);

    try {
      await submit({
        email: email.value,
        content: content.value,
        domain: location.hostname,
      });
      form.reset();
      showStatus('success', widget.dataset.feedbackSuccess || '');
    } catch (error) {
      if (!(error instanceof FeedbackValidationError) || !showFieldError(error)) {
        showStatus('error', widget.dataset.feedbackError || '');
      }
    } finally {
      setSubmitting(false);
    }
  };

  opener.addEventListener('click', onOpen);
  closeButton.addEventListener('click', onClose);
  form.addEventListener('submit', onSubmit);
  email.addEventListener('input', onEmailInput);
  content.addEventListener('input', onContentInput);
  doc.addEventListener('keydown', onKeydown);
  doc.addEventListener('pointerdown', onPointerDown);

  return () => {
    observer.disconnect();
    opener.removeEventListener('click', onOpen);
    closeButton.removeEventListener('click', onClose);
    form.removeEventListener('submit', onSubmit);
    email.removeEventListener('input', onEmailInput);
    content.removeEventListener('input', onContentInput);
    doc.removeEventListener('keydown', onKeydown);
    doc.removeEventListener('pointerdown', onPointerDown);
  };
}
