import { describe, expect, it, vi } from 'vitest';
import { ENDPOINTS } from '../constants/api-endpoints.js';
import { http } from '../http/http-client.js';
import { sendFeedback } from './feedback.service.js';

vi.mock('../http/http-client.js', () => ({
  http: {
    post: vi.fn(),
  },
}));

describe('sendFeedback', () => {
  it('posts the exact feedback payload to the configured endpoint', async () => {
    const payload = {
      email: 'person@example.com',
      content: 'Helpful product',
      domain: 'solprompter.com',
    };
    const response = { success: true };
    http.post.mockResolvedValueOnce(response);

    await expect(sendFeedback(payload)).resolves.toBe(response);
    expect(http.post).toHaveBeenCalledWith(ENDPOINTS.FEEDBACK_SUBMIT, payload);
    expect(ENDPOINTS.FEEDBACK_SUBMIT).toEqual({
      path: '/feedback',
      baseUrl: 'https://feedback-api.solplatform.workers.dev',
      method: 'POST',
      timeoutKey: 'default',
    });
  });
});
