import { sendFeedback } from '../../services/feedback.service.js';
import { toFeedback } from './feedback.model.js';

export async function submitFeedback(raw, send = sendFeedback) {
  const response = await send(toFeedback(raw));
  if (response?.success === false) throw new Error('Feedback submission failed');
  return response;
}
