import type { QueryOptions } from './types.ts';

export function normalizeResponse(response: any) {
  if (
    response &&
    typeof response === 'object' &&
    Object.prototype.hasOwnProperty.call(response, 'success')
  ) {
    if (response.success === false) {
      const error = new Error(response.message || 'Business Error');
      error.name = 'BusinessError';
      (error as any).code = response.code;
      (error as any).response = response;
      throw error;
    }

    return {
      data: Object.prototype.hasOwnProperty.call(response, 'data')
        ? response.data
        : response,
    };
  }

  return { data: response };
}

export function normalizeResult(
  response: unknown,
  normalize?: false | ((response: unknown) => unknown)
) {
  if (normalize === false) return { data: response };
  const normalized = (normalize || normalizeResponse)(response);
  if (
    !normalized ||
    typeof normalized !== 'object' ||
    !('data' in normalized)
  ) {
    return { data: normalized };
  }
  return normalized as { data: any };
}

export function shouldRetry(error: any) {
  if (!error) return false;
  if (error.name === 'AbortError') return false;
  if (error.name === 'TimeoutError') return true;

  const status = error.status ?? error.response?.status;
  if (status >= 400 && status < 500) return false;

  return true;
}

export function canRetry(
  error: any,
  attempt: number,
  options: QueryOptions<any>
) {
  const retry = options.retry;
  const should = options.shouldRetry || shouldRetry;

  if (!should(error, attempt)) return false;
  if (typeof retry === 'function') return retry(attempt, error) === true;

  return attempt <= Number(retry || 0);
}

export function resolveRetryDelay(
  retryDelay: QueryOptions['retryDelay'],
  attempt: number,
  error: any
) {
  const delay =
    typeof retryDelay === 'function' ? retryDelay(attempt, error) : retryDelay;
  return Math.max(Number(delay) || 0, 0);
}

export function withTimeout<TValue>(
  promise: Promise<TValue>,
  timeout: number | undefined,
  controller: AbortController | undefined
) {
  const duration = Number(timeout || 0);
  if (!duration || duration < 0) return promise;

  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort?.();
      const error = new Error('Query timed out');
      error.name = 'TimeoutError';
      reject(error);
    }, duration);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}
