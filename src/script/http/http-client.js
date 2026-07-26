import { getApiBaseUrl, getTimeout } from '../environment.js';
import { HttpError, NetworkError } from './errors.js';

async function request(endpoint, { method, body, timeoutKey, baseUrl, headers = {}, signal, parseAs = 'json' } = {}) {
  const spec = typeof endpoint === 'string' ? { path: endpoint } : endpoint;

  const resolvedBaseUrl    = baseUrl      ?? spec.baseUrl    ?? getApiBaseUrl();
  const resolvedMethod     = method       ?? spec.method     ?? 'GET';
  const resolvedTimeoutKey = timeoutKey   ?? spec.timeoutKey ?? 'default';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getTimeout(resolvedTimeoutKey));
  let abortHandler;
  if (signal) {
    abortHandler = () => controller.abort();
    signal.addEventListener('abort', abortHandler);
  }

  const url = `${resolvedBaseUrl}${spec.path}`;

  try {
    const res = await fetch(url, {
      method:  resolvedMethod,
      headers: { 'Content-Type': 'application/json', ...headers },
      body:    body !== undefined ? JSON.stringify(body) : undefined,
      signal:  controller.signal,
    });
    clearTimeout(timer);
    if (abortHandler) signal.removeEventListener('abort', abortHandler);

    // 204 No Content (DELETE) → no body; text/plain (export) → res.text(); default JSON.
    const data = res.status === 204
      ? null
      : parseAs === 'text'
        ? await res.text().catch(() => null)
        : await res.json().catch(() => null);

    if (!res.ok) {
      throw new HttpError(res.status, data);
    }
    return data;
  } catch (err) {
    clearTimeout(timer);
    if (abortHandler) signal.removeEventListener('abort', abortHandler);
    if (err instanceof HttpError) throw err;
    throw new NetworkError(err);
  }
}

export const http = {
  get:   (endpoint, opts)       => request(endpoint, { ...opts }),
  post:  (endpoint, body, opts) => request(endpoint, { ...opts, method: 'POST', body }),
  patch: (endpoint, body, opts) => request(endpoint, { ...opts, method: 'PATCH', body }),
  del:   (endpoint, body, opts) => request(endpoint, { ...opts, method: 'DELETE', body }),
};
