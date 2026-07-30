// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedbackValidationError } from './feedback.model.js';
import { initFeedbackUI } from './feedback.ui.js';

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

function renderWidget() {
  document.body.innerHTML = `
    <aside
      data-feedback-widget
      data-feedback-success="Thanks for your feedback."
      data-feedback-error="Something went wrong. Please try again."
      data-feedback-email-required="Enter your email address."
      data-feedback-email-invalid="Enter a valid email address."
      data-feedback-content-required="Enter your feedback."
      data-feedback-content-too-short="Feedback must be at least 3 characters."
      data-feedback-content-too-long="Feedback must be no more than 5000 characters."
    >
      <button
        type="button"
        data-feedback-open
        aria-expanded="false"
        aria-controls="feedback-dialog"
      >Feedback</button>
      <section
        id="feedback-dialog"
        data-feedback-dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        hidden
      >
        <h2 id="feedback-title">Send feedback</h2>
        <button type="button" data-feedback-close aria-label="Close feedback form">Close</button>
        <form data-feedback-form novalidate>
          <label for="feedback-email">Email</label>
          <input
            id="feedback-email"
            name="email"
            type="email"
            autocomplete="email"
            required
            aria-describedby="feedback-email-error"
          >
          <p id="feedback-email-error" data-feedback-email-error hidden></p>
          <label for="feedback-content">Feedback</label>
          <textarea
            id="feedback-content"
            name="content"
            minlength="3"
            maxlength="5000"
            required
            aria-describedby="feedback-content-error"
          ></textarea>
          <p id="feedback-content-error" data-feedback-content-error hidden></p>
          <button type="submit" data-feedback-submit>Send feedback</button>
          <p data-feedback-status role="status" hidden></p>
        </form>
      </section>
    </aside>
  `;

  return {
    widget: document.querySelector('[data-feedback-widget]'),
    opener: document.querySelector('[data-feedback-open]'),
    dialog: document.querySelector('[data-feedback-dialog]'),
    form: document.querySelector('[data-feedback-form]'),
    email: document.querySelector('[name="email"]'),
    content: document.querySelector('[name="content"]'),
    submitButton: document.querySelector('[data-feedback-submit]'),
    status: document.querySelector('[data-feedback-status]'),
  };
}

function submitForm(form) {
  form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
}

describe('initFeedbackUI', () => {
  let cleanup;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    if (typeof cleanup === 'function') cleanup();
    cleanup = undefined;
    document.body.innerHTML = '';
  });

  it('is a safe no-op when the page has no feedback widget', () => {
    expect(() => {
      cleanup = initFeedbackUI({ root: document });
    }).not.toThrow();
    expect(typeof cleanup).toBe('function');
  });

  it('opens accessibly, closes on Escape, and returns focus to the trigger', () => {
    const { opener, dialog, email } = renderWidget();
    cleanup = initFeedbackUI({ root: document });

    opener.click();

    expect(dialog.hidden).toBe(false);
    expect(opener.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(email);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(dialog.hidden).toBe(true);
    expect(opener.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(opener);
  });

  it('submits email, content, and the current hostname and shows the success state', async () => {
    const submit = vi.fn().mockResolvedValue({ accepted: true });
    const { opener, dialog, form, email, content, submitButton, status } = renderWidget();
    cleanup = initFeedbackUI({
      root: document,
      submit,
      location: { hostname: 'app.solprompter.com' },
    });
    opener.click();
    email.value = 'person@example.com';
    content.value = 'The editor is excellent.';

    submitForm(form);

    expect(submitButton.disabled).toBe(true);
    expect(submit).toHaveBeenCalledWith({
      email: 'person@example.com',
      content: 'The editor is excellent.',
      domain: 'app.solprompter.com',
    });

    await flushPromises();

    expect(submitButton.disabled).toBe(false);
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe('Thanks for your feedback.');
    expect(form.reset).toBeTypeOf('function');
    expect(email.value).toBe('');
    expect(content.value).toBe('');
    expect(dialog.dataset.state).toBe('success');
  });

  it.each([
    ['email', 'invalid', 'Enter a valid email address.'],
    ['content', 'too_short', 'Feedback must be at least 3 characters.'],
    ['content', 'too_long', 'Feedback must be no more than 5000 characters.'],
  ])('shows a field-level %s %s validation error', async (field, code, message) => {
    const submit = vi.fn().mockRejectedValue(new FeedbackValidationError(field, code));
    const { opener, form, email, content } = renderWidget();
    cleanup = initFeedbackUI({
      root: document,
      submit,
      location: { hostname: 'solprompter.com' },
    });
    opener.click();
    email.value = 'person@example.com';
    content.value = 'Useful feedback';

    submitForm(form);
    await flushPromises();

    const input = field === 'email' ? email : content;
    const error = document.querySelector(`[data-feedback-${field}-error]`);
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe(message);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(input);
  });

  it('shows a retryable error and restores the submit button when submission fails', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('Network details must not reach the UI'));
    const { opener, dialog, form, email, content, submitButton, status } = renderWidget();
    cleanup = initFeedbackUI({
      root: document,
      submit,
      location: { hostname: 'solprompter.com' },
    });
    opener.click();
    email.value = 'person@example.com';
    content.value = 'Useful feedback';

    submitForm(form);
    await flushPromises();

    expect(submitButton.disabled).toBe(false);
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe('Something went wrong. Please try again.');
    expect(status.textContent).not.toContain('Network details');
    expect(dialog.dataset.state).toBe('error');
  });

  it('hides the widget when tp-page class is added to html or tp to body', async () => {
    const { widget } = renderWidget();
    cleanup = initFeedbackUI({ root: document });

    // Initial state
    expect(widget.style.display).toBe('');

    // Add tp-page to documentElement
    document.documentElement.classList.add('tp-page');
    // MutationObservers are asynchronous, wait a tick
    await flushPromises();
    expect(widget.style.display).toBe('none');

    // Remove tp-page from documentElement
    document.documentElement.classList.remove('tp-page');
    await flushPromises();
    expect(widget.style.display).toBe('');

    // Add tp to body
    document.body.classList.add('tp');
    await flushPromises();
    expect(widget.style.display).toBe('none');

    // Clean up classes
    document.body.classList.remove('tp');
    await flushPromises();
  });
});

