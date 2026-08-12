import type { NormalizeFn, QueryOptions } from './types.ts';

export interface BusinessError extends Error {
  code?: unknown;
  response?: unknown;
}

export interface NormalizedResponse<TData = unknown> {
  data: TData;
}

export function normalizeResponse<TData = unknown>(
  response: unknown
): NormalizedResponse<TData> {
  if (
    response &&
    typeof response === 'object' &&
    Object.prototype.hasOwnProperty.call(response, 'success')
  ) {
    const record = response as Record<string, unknown>;

    if (record.success === false) {
      const error = new Error(
        typeof record.message === 'string' ? record.message : 'Business Error'
      ) as BusinessError;
      error.name = 'BusinessError';
      error.code = record.code;
      error.response = response;
      throw error;
    }

    return {
      data: (Object.prototype.hasOwnProperty.call(record, 'data')
        ? record.data
        : response) as TData,
    };
  }

  return { data: response as TData };
}

export function normalizeResult<TData = unknown>(
  response: unknown,
  normalize?: false | NormalizeFn<TData>
): NormalizedResponse<TData> {
  if (normalize === false) return { data: response as TData };
  const normalized = (normalize || normalizeResponse<TData>)(response);
  if (
    !normalized ||
    typeof normalized !== 'object' ||
    !('data' in normalized)
  ) {
    return { data: normalized as TData };
  }
  return normalized as NormalizedResponse<TData>;
}

export function shouldRetry(error: unknown) {
  if (!error) return false;
  const record = error as {
    name?: unknown;
    response?: { status?: unknown };
    status?: unknown;
  };

  if (record.name === 'AbortError') return false;
  if (record.name === 'TimeoutError') return true;

  const status = Number(record.status ?? record.response?.status);
  if (status >= 400 && status < 500) return false;

  return true;
}

export function canRetry<TError = unknown>(
  error: TError,
  attempt: number,
  options: Pick<
    QueryOptions<unknown, unknown, unknown, TError>,
    'retry' | 'shouldRetry'
  >
) {
  const retry = options.retry;
  const should = options.shouldRetry || shouldRetry;

  if (!should(error, attempt)) return false;
  if (typeof retry === 'function') return retry(attempt, error) === true;

  return attempt <= Number(retry || 0);
}

export function resolveRetryDelay<TError = unknown>(
  retryDelay: QueryOptions<unknown, unknown, unknown, TError>['retryDelay'],
  attempt: number,
  error: TError
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
