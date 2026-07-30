import { describe, expect, it, vi } from 'vitest';
import { FeedbackValidationError } from './feedback.model.js';
import { submitFeedback } from './feedback.logic.js';

vi.mock('../../services/feedback.service.js', () => ({
  sendFeedback: vi.fn(),
}));

describe('submitFeedback', () => {
  it('maps the raw form values before calling the service and returns its result', async () => {
    const response = { accepted: true };
    const send = vi.fn().mockResolvedValue(response);

    await expect(submitFeedback({
      email: '  person@example.com ',
      content: '  Helpful product  ',
      domain: ' solprompter.com ',
    }, send)).resolves.toBe(response);

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      email: 'person@example.com',
      content: 'Helpful product',
      domain: 'solprompter.com',
    });
  });

  it('rejects invalid feedback without calling the service', async () => {
    const send = vi.fn();

    await expect(submitFeedback({
      email: 'invalid',
      content: 'Helpful product',
      domain: 'solprompter.com',
    }, send)).rejects.toMatchObject({
      name: FeedbackValidationError.name,
      field: 'email',
      code: 'invalid',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('treats an unsuccessful API payload as a failed submission', async () => {
    const send = vi.fn().mockResolvedValue({
      success: false,
      error: 'Backend details stay out of the UI',
    });

    await expect(submitFeedback({
      email: 'person@example.com',
      content: 'Helpful product',
      domain: 'solprompter.com',
    }, send)).rejects.toThrow('Feedback submission failed');
  });
});
