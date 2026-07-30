import { ENDPOINTS } from '../constants/api-endpoints.js';
import { http } from '../http/http-client.js';

export function sendFeedback(feedback) {
  return http.post(ENDPOINTS.FEEDBACK_SUBMIT, feedback);
}
