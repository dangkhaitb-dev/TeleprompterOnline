export class HttpError extends Error {
  constructor(status, data) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
    this.data = data;
  }
}

export class NetworkError extends Error {
  constructor(cause) {
    const isTimeout = cause?.name === 'AbortError';
    super(isTimeout ? 'Request timed out' : 'Network error');
    this.name = 'NetworkError';
    this.cause = cause;
    this.isTimeout = isTimeout;
  }
}
