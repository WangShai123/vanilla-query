import { access, createDeepStore, createEffect, untrack } from 'vanilla-signal';
import Lru from 'vanilla-simple-lru';

const DEFAULT_CACHE_TIME = 1000 * 60 * 5;
const DEFAULT_STALE_TIME = 0;

const defaultOptions = {
  enabled: true,
  initialData: undefined,
  keepPreviousData: true,
  refetchOnMount: true,
  staleTime: DEFAULT_STALE_TIME,
  cacheTime: DEFAULT_CACHE_TIME,
  gcTime: DEFAULT_CACHE_TIME,
  cache: true,
  cacheMax: 100,
  cacheKey: 'default',
  dedupe: true,
  retry: 0,
  retryDelay: (attempt) =>
    Math.min(1000 * 2 ** Math.max(attempt - 1, 0), 30000),
  timeout: 0,
  throwErrors: false,
  suspense: false,
  select: undefined,
  normalize: normalizeResponse,
  shouldRetry,
  onSuccess: undefined,
  onError: undefined,
  onSettled: undefined,
};

const defaultClient = createQueryClient();

export function createQuery(options) {
  if (typeof options === 'function') {
    options = { queryFn: options };
  }

  const queryOptions = normalizeOptions(options);
  const client = queryOptions.client || defaultClient;

  if (typeof queryOptions.queryFn !== 'function') {
    throw new TypeError('createQuery requires a queryFn');
  }

  const initialData = resolveValue(queryOptions.initialData);
  const hasInitialData = initialData !== undefined;
  const initialUpdatedAt = hasInitialData ? now() : 0;
  const state = createDeepStore({
    data: initialData,
    latest: initialData,
    error: null,
    failureCount: 0,
    isError: false,
    isFetching: false,
    isLoading: false,
    isPending: !hasInitialData,
    isPaused: !readEnabled(queryOptions),
    isStale: hasInitialData,
    isSuccess: hasInitialData,
    status: hasInitialData ? 'success' : 'pending',
    fetchStatus: 'idle',
    dataUpdatedAt: initialUpdatedAt,
    errorUpdatedAt: 0,
    updatedAt: initialUpdatedAt,
  });

  let requestId = 0;
  let currentKey = '';
  let currentQueryKey = undefined;
  let currentPromise = null;
  let currentAbortController = null;
  let disposed = false;
  let latestQueryKey = undefined;
  const subscribers = new Set();

  const query = function readQueryData() {
    if (queryOptions.suspense && state.isPending && currentPromise) {
      throw currentPromise;
    }

    if (queryOptions.throwErrors && state.error) {
      throw state.error;
    }

    return state.data;
  };

  query.state = state;
  query.key = () => currentKey || hashQueryKey(readQueryKey(queryOptions));
  query.queryKey = () => latestQueryKey;
  query.promise = () => currentPromise;
  query.refetch = (refetchOptions = {}) =>
    execute({
      ...refetchOptions,
      force: refetchOptions.force ?? true,
      keepPreviousData: refetchOptions.keepPreviousData ?? true,
      meta: refetchOptions.meta,
    });
  query.reload = (reloadOptions = {}) =>
    execute({
      ...reloadOptions,
      force: reloadOptions.force ?? true,
      keepPreviousData: reloadOptions.keepPreviousData ?? false,
      meta: reloadOptions.meta,
    });
  query.retry = () => execute({ force: true, keepPreviousData: true });
  query.mutate = (updater, mutateOptions = {}) => {
    const key = query.key();
    const nextData =
      typeof updater === 'function' ? updater(state.data) : updater;

    applySuccess(nextData, {
      key,
      updatedAt: mutateOptions.updatedAt ?? now(),
      fromCache: false,
      notify: mutateOptions.notify ?? true,
    });

    if (mutateOptions.cache !== false && queryOptions.cache) {
      client.setQueryData(key, nextData, {
        cacheMax: queryOptions.cacheMax,
        cacheTime: queryOptions.cacheTime,
        cacheKey: queryOptions.cacheKey,
        staleTime: mutateOptions.staleTime ?? queryOptions.staleTime,
        queryKey: latestQueryKey,
        meta: mutateOptions.meta,
      });
    }

    return nextData;
  };
  query.invalidate = () => client.invalidateQueries(query.key());
  query.remove = () => {
    abort();
    client.removeQueries(query.key());
    currentPromise = null;
    currentAbortController = null;
    setIdleState({ keepData: false });
  };
  query.abort = abort;
  query.destroy = destroy;
  query.subscribe = subscribe;

  const effect = createEffect(() => {
    const nextQueryKey = readQueryKey(queryOptions);
    const nextKey = hashQueryKey(nextQueryKey);
    const enabled = readEnabled(queryOptions);

    latestQueryKey = nextQueryKey;

    untrack(() => {
      if (disposed) return;

      const keyChanged = nextKey !== currentKey;
      currentKey = nextKey;
      currentQueryKey = nextQueryKey;
      state.isPaused = !enabled;

      if (!enabled) {
        setIdleState({ keepData: true });
        return;
      }

      const entry = queryOptions.cache
        ? client.getQueryEntry(nextKey, queryOptions)
        : undefined;

      if (entry) {
        applySuccess(entry.data, {
          key: nextKey,
          updatedAt: entry.updatedAt,
          fromCache: true,
          notify: false,
        });

        if (
          !entry.isStale &&
          !keyChanged &&
          queryOptions.refetchOnMount !== 'always'
        ) {
          return;
        }

        if (!entry.isStale && queryOptions.refetchOnMount === false) {
          return;
        }
      } else if (keyChanged && !queryOptions.keepPreviousData) {
        resetForNewKey();
      }

      if (
        keyChanged ||
        queryOptions.refetchOnMount === 'always' ||
        !entry ||
        entry.isStale
      ) {
        execute({
          force: false,
          keepPreviousData: queryOptions.keepPreviousData,
        }).catch(noop);
      }
    });
  });

  return query;

  async function execute(executeOptions = {}) {
    if (disposed) return state.data;

    const key = currentKey || hashQueryKey(readQueryKey(queryOptions));
    const queryKey = currentQueryKey ?? readQueryKey(queryOptions);
    const enabled = readEnabled(queryOptions);
    const force = executeOptions.force === true;

    latestQueryKey = queryKey;
    currentKey = key;
    currentQueryKey = queryKey;

    if (!force && !enabled) {
      state.isPaused = true;
      return state.data;
    }

    if (!force && queryOptions.cache) {
      const entry = client.getQueryEntry(key, queryOptions);
      if (entry && !entry.isStale) {
        applySuccess(entry.data, {
          key,
          updatedAt: entry.updatedAt,
          fromCache: true,
          notify: false,
        });
        return entry.data;
      }
    }

    const fetchId = ++requestId;
    const keepData =
      executeOptions.keepPreviousData ?? queryOptions.keepPreviousData;

    beginFetch({ keepData });

    const task = client.fetchQuery({
      key,
      queryKey,
      queryFn: queryOptions.queryFn,
      force,
      dedupe: queryOptions.dedupe,
      cache: queryOptions.cache,
      cacheMax: queryOptions.cacheMax,
      cacheTime: queryOptions.cacheTime,
      cacheKey: queryOptions.cacheKey,
      staleTime: queryOptions.staleTime,
      retry: queryOptions.retry,
      retryDelay: queryOptions.retryDelay,
      shouldRetry: queryOptions.shouldRetry,
      timeout: queryOptions.timeout,
      normalize: queryOptions.normalize,
      select: queryOptions.select,
      meta: executeOptions.meta,
      getSignal(controller) {
        currentAbortController = controller;
      },
    });

    currentPromise = task;

    try {
      const result = await task;
      if (disposed || fetchId !== requestId) return state.data;

      applySuccess(result.data, {
        key,
        updatedAt: result.updatedAt,
        fromCache: result.fromCache,
        notify: true,
      });

      queryOptions.onSuccess?.(result.data, {
        query,
        queryKey,
        key,
        fromCache: result.fromCache,
        meta: executeOptions.meta,
      });
      return result.data;
    } catch (error) {
      if (disposed || fetchId !== requestId) return state.data;
      applyError(error);
      queryOptions.onError?.(error, {
        query,
        queryKey,
        key,
        meta: executeOptions.meta,
      });
      throw error;
    } finally {
      if (fetchId === requestId) {
        state.isFetching = false;
        state.isLoading = false;
        state.fetchStatus = 'idle';
        currentAbortController = null;
        currentPromise = null;
      }
      queryOptions.onSettled?.(state.data, state.error, {
        query,
        queryKey,
        key,
        meta: executeOptions.meta,
      });
    }
  }

  function beginFetch({ keepData }) {
    const hasData = state.data !== undefined;
    const shouldKeepData = keepData && hasData;

    if (!shouldKeepData) {
      state.data = undefined;
    }

    state.error = null;
    state.isError = false;
    state.isFetching = true;
    state.isLoading = !shouldKeepData;
    state.isPending = !shouldKeepData && state.data === undefined;
    state.isPaused = false;
    state.isStale = shouldKeepData;
    state.fetchStatus = 'fetching';
    state.status = shouldKeepData ? state.status : 'pending';
    state.updatedAt = now();
  }

  function applySuccess(data, { key, updatedAt, notify }) {
    state.data = data;
    state.latest = data;
    state.error = null;
    state.failureCount = 0;
    state.isError = false;
    state.isFetching = false;
    state.isLoading = false;
    state.isPending = false;
    state.isPaused = false;
    state.isStale = isEntryStaleByTime(updatedAt, queryOptions.staleTime);
    state.isSuccess = true;
    state.status = 'success';
    state.fetchStatus = 'idle';
    state.dataUpdatedAt = updatedAt;
    state.updatedAt = updatedAt;

    if (notify) {
      client.notify({ type: 'success', key, data, state });
    }
  }

  function applyError(error) {
    state.error = error;
    state.failureCount += 1;
    state.isError = true;
    state.isFetching = false;
    state.isLoading = false;
    state.isPending = false;
    state.isPaused = false;
    state.isStale = state.data !== undefined;
    state.isSuccess = false;
    state.status = 'error';
    state.fetchStatus = 'idle';
    state.errorUpdatedAt = now();
    state.updatedAt = state.errorUpdatedAt;
  }

  function resetForNewKey() {
    state.data = undefined;
    state.error = null;
    state.isError = false;
    state.isLoading = false;
    state.isPending = true;
    state.isStale = false;
    state.isSuccess = false;
    state.status = 'pending';
    state.fetchStatus = 'idle';
  }

  function setIdleState({ keepData }) {
    if (!keepData) {
      state.data = undefined;
      state.latest = undefined;
      state.error = null;
      state.failureCount = 0;
      state.isError = false;
      state.isPending = true;
      state.isSuccess = false;
      state.status = 'pending';
      state.dataUpdatedAt = 0;
      state.errorUpdatedAt = 0;
    }

    state.isFetching = false;
    state.isLoading = false;
    state.fetchStatus = 'idle';
  }

  function abort() {
    requestId += 1;
    currentAbortController?.abort?.();
    currentAbortController = null;
    currentPromise = null;
    state.isFetching = false;
    state.isLoading = false;
    state.fetchStatus = 'idle';
  }

  function destroy() {
    if (disposed) return;
    disposed = true;
    abort();
    effect?.dispose?.();
    subscribers.clear();
  }

  function subscribe(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('query.subscribe requires a callback');
    }

    subscribers.add(callback);

    const subscription = createEffect(() => {
      const snapshot = [
        state.updatedAt,
        state.status,
        state.fetchStatus,
        state.data,
        state.error,
      ];

      untrack(() => {
        if (subscribers.has(callback)) callback(state, snapshot);
      });
    });

    return () => {
      subscribers.delete(callback);
      subscription.dispose?.();
    };
  }
}

export function createQueryClient(options = {}) {
  const clientOptions = {
    cacheMax: options.cacheMax ?? defaultOptions.cacheMax,
    cacheTime: options.cacheTime ?? defaultOptions.cacheTime,
  };
  const caches = new Map();
  const pendingRequests = new Map();
  const listeners = new Set();

  return {
    fetchQuery,
    prefetchQuery,
    getQueryData,
    getQueryEntry,
    setQueryData,
    invalidateQueries,
    removeQueries,
    clear,
    subscribe,
    notify,
    getCache,
    hashQueryKey,
  };

  function getCache(cacheOptions = {}) {
    const max = cacheOptions.cacheMax ?? clientOptions.cacheMax;
    const cacheTime = normalizePositiveNumber(
      cacheOptions.cacheTime ?? clientOptions.cacheTime,
      DEFAULT_CACHE_TIME
    );
    const cacheKey = cacheOptions.cacheKey ?? 'default';

    if (!caches.has(cacheKey)) {
      caches.set(cacheKey, new Lru({ max, ttl: cacheTime }));
    } else if (
      Number.isInteger(max) &&
      max > 0 &&
      caches.get(cacheKey).max !== max
    ) {
      caches.get(cacheKey).resize(max);
    }

    return caches.get(cacheKey);
  }

  async function fetchQuery(options) {
    const key = options.key ?? hashQueryKey(options.queryKey);
    const cacheEnabled = options.cache !== false;

    if (!options.force && cacheEnabled) {
      const entry = getQueryEntry(key, options);
      if (entry && !entry.isStale) {
        return {
          data: entry.data,
          updatedAt: entry.updatedAt,
          fromCache: true,
        };
      }
    }

    if (options.dedupe !== false && pendingRequests.has(key)) {
      return pendingRequests.get(key);
    }

    const promise = runFetch(key, options);
    if (options.dedupe !== false) {
      pendingRequests.set(key, promise);
      promise.then(
        () => {
          if (pendingRequests.get(key) === promise) {
            pendingRequests.delete(key);
          }
        },
        () => {
          if (pendingRequests.get(key) === promise) {
            pendingRequests.delete(key);
          }
        }
      );
    }

    return promise;
  }

  async function prefetchQuery(options) {
    const result = await fetchQuery({
      ...options,
      force: options.force ?? false,
      cache: options.cache ?? true,
      dedupe: options.dedupe ?? true,
    });
    return result.data;
  }

  function getQueryData(queryKey, cacheOptions = {}) {
    return getQueryEntry(queryKey, cacheOptions)?.data;
  }

  function getQueryEntry(queryKey, cacheOptions = {}) {
    const key = looksHashedKey(queryKey) ? queryKey : hashQueryKey(queryKey);
    const cache = getCache(cacheOptions);
    const record = cache.get(key);
    if (!record) return undefined;

    return {
      ...record,
      isStale:
        record.invalidated ||
        isEntryStaleByTime(record.updatedAt, record.staleTime),
    };
  }

  function setQueryData(queryKey, updater, cacheOptions = {}) {
    const key = looksHashedKey(queryKey) ? queryKey : hashQueryKey(queryKey);
    const previous = getQueryEntry(key, cacheOptions)?.data;
    const data = typeof updater === 'function' ? updater(previous) : updater;
    const updatedAt = cacheOptions.updatedAt ?? now();
    const staleTime = cacheOptions.staleTime ?? DEFAULT_STALE_TIME;

    getCache(cacheOptions).set(
      key,
      {
        data,
        queryKey: cacheOptions.queryKey,
        updatedAt,
        staleTime,
        invalidated: false,
        meta: cacheOptions.meta,
      },
      {
        maxAge: normalizePositiveNumber(
          cacheOptions.cacheTime,
          clientOptions.cacheTime
        ),
      }
    );

    notify({ type: 'set', key, data });
    return data;
  }

  function invalidateQueries(filter) {
    let count = 0;

    forEachCacheEntry(filter, (cache, key, record) => {
      cache.set(
        key,
        {
          ...record,
          invalidated: true,
        },
        {
          maxAge: Math.max(cache.expiresIn(key) ?? clientOptions.cacheTime, 1),
        }
      );
      count += 1;
      notify({ type: 'invalidate', key, data: record.data });
    });

    return count;
  }

  function removeQueries(filter) {
    let count = 0;

    forEachCacheEntry(filter, (cache, key, record) => {
      cache.delete(key);
      pendingRequests.delete(key);
      count += 1;
      notify({ type: 'remove', key, data: record.data });
    });

    return count;
  }

  function clear() {
    caches.forEach((cache) => cache.clear());
    caches.clear();
    pendingRequests.clear();
    notify({ type: 'clear' });
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('queryClient.subscribe requires a listener');
    }

    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function notify(event) {
    listeners.forEach((listener) => listener(event));
  }

  async function runFetch(key, options) {
    let attempt = 0;

    while (true) {
      attempt += 1;
      const controller =
        typeof AbortController === 'function'
          ? new AbortController()
          : undefined;
      options.getSignal?.(controller);

      try {
        const raw = await withTimeout(
          Promise.resolve(
            options.queryFn({
              attempt,
              queryKey: options.queryKey,
              signal: controller?.signal,
              meta: options.meta,
            })
          ),
          options.timeout,
          controller
        );
        const normalized = normalizeResult(raw, options.normalize);
        const selected =
          typeof options.select === 'function'
            ? options.select(normalized.data)
            : normalized.data;
        const updatedAt = now();

        if (options.cache !== false) {
          setQueryData(key, selected, {
            cacheMax: options.cacheMax,
            cacheTime: options.cacheTime,
            cacheKey: options.cacheKey,
            staleTime: options.staleTime,
            updatedAt,
            queryKey: options.queryKey,
            meta: options.meta,
          });
        }

        notify({ type: 'fetch', key, data: selected });
        return {
          data: selected,
          updatedAt,
          fromCache: false,
        };
      } catch (error) {
        if (!canRetry(error, attempt, options)) {
          notify({ type: 'error', key, error });
          throw error;
        }

        await sleep(resolveRetryDelay(options.retryDelay, attempt, error));
      }
    }
  }

  function forEachCacheEntry(filter, callback) {
    const matcher = createMatcher(filter);

    caches.forEach((cache) => {
      for (const [key, record] of cache.entries()) {
        if (matcher(key, record)) {
          callback(cache, key, record);
        }
      }
    });
  }
}

export { defaultClient as queryClient };

export function hashQueryKey(queryKey) {
  return stableHash(queryKey === undefined ? ['query'] : queryKey);
}

export function stableHash(value, seen = new WeakMap()) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';

  const type = typeof value;
  if (type === 'number' || type === 'boolean' || type === 'bigint') {
    return `${type}:${String(value)}`;
  }
  if (type === 'string') return `string:${JSON.stringify(value)}`;
  if (type === 'symbol') return `symbol:${String(value.description)}`;
  if (type === 'function') return `function:${value.name || 'anonymous'}`;
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (value instanceof RegExp) return `regexp:${String(value)}`;

  if (seen.has(value)) return `[Circular:${seen.get(value)}]`;
  seen.set(value, seen.size);

  if (Array.isArray(value)) {
    return `array:[${value.map((item) => stableHash(item, seen)).join(',')}]`;
  }

  if (value instanceof Map) {
    const entries = Array.from(value.entries()).map(([key, item]) => [
      stableHash(key, seen),
      stableHash(item, seen),
    ]);
    entries.sort(([left], [right]) =>
      left > right ? 1 : left < right ? -1 : 0
    );
    return `map:{${entries.map(([key, item]) => `${key}:${item}`).join(',')}}`;
  }

  if (value instanceof Set) {
    const entries = Array.from(value.values()).map((item) =>
      stableHash(item, seen)
    );
    entries.sort();
    return `set:{${entries.join(',')}}`;
  }

  const keys = Object.keys(value).sort();
  return `object:{${keys
    .map((key) => `${JSON.stringify(key)}:${stableHash(value[key], seen)}`)
    .join(',')}}`;
}

function normalizeOptions(options = {}) {
  const cacheOptions =
    options.cache && typeof options.cache === 'object'
      ? options.cache
      : undefined;

  return {
    ...defaultOptions,
    ...options,
    cache:
      options.cache === undefined
        ? defaultOptions.cache
        : options.cache !== false,
    cacheMax:
      options.cacheMax ??
      cacheOptions?.maxSize ??
      cacheOptions?.max ??
      defaultOptions.cacheMax,
    cacheTime:
      options.cacheTime ??
      options.gcTime ??
      cacheOptions?.maxAge ??
      cacheOptions?.ttl ??
      defaultOptions.cacheTime,
    gcTime:
      options.gcTime ??
      options.cacheTime ??
      cacheOptions?.maxAge ??
      cacheOptions?.ttl ??
      defaultOptions.gcTime,
    staleTime:
      options.staleTime ?? cacheOptions?.staleTime ?? defaultOptions.staleTime,
  };
}

function readQueryKey(options) {
  const key = access(options.queryKey);
  return key === undefined ? ['anonymous'] : key;
}

function readEnabled(options) {
  return options.enabled !== false && access(options.enabled) !== false;
}

function resolveValue(value) {
  return typeof value === 'function' ? value() : value;
}

function normalizeResponse(response) {
  if (
    response &&
    typeof response === 'object' &&
    Object.prototype.hasOwnProperty.call(response, 'success')
  ) {
    if (response.success === false) {
      const error = new Error(response.message || 'Business Error');
      error.name = 'BusinessError';
      error.code = response.code;
      error.response = response;
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

function normalizeResult(response, normalize) {
  if (normalize === false) return { data: response };
  const normalized = (normalize || normalizeResponse)(response);
  if (
    !normalized ||
    typeof normalized !== 'object' ||
    !('data' in normalized)
  ) {
    return { data: normalized };
  }
  return normalized;
}

function shouldRetry(error) {
  if (!error) return false;
  if (error.name === 'AbortError') return false;
  if (error.name === 'TimeoutError') return true;

  const status = error.status ?? error.response?.status;
  if (status >= 400 && status < 500) return false;

  return true;
}

function canRetry(error, attempt, options) {
  const retry = options.retry;
  const should = options.shouldRetry || shouldRetry;

  if (!should(error, attempt)) return false;
  if (typeof retry === 'function') return retry(attempt, error) === true;

  return attempt <= Number(retry || 0);
}

function resolveRetryDelay(retryDelay, attempt, error) {
  const delay =
    typeof retryDelay === 'function' ? retryDelay(attempt, error) : retryDelay;
  return Math.max(Number(delay) || 0, 0);
}

function withTimeout(promise, timeout, controller) {
  const duration = Number(timeout || 0);
  if (!duration || duration < 0) return promise;

  let timer;
  const timeoutPromise = new Promise((_, reject) => {
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

function createMatcher(filter) {
  if (filter === undefined || filter === null) return () => true;
  if (typeof filter === 'function') return filter;
  if (typeof filter === 'string')
    return (key) => key === filter || key.includes(filter);

  const target = hashQueryKey(filter);
  return (key, record) =>
    key === target ||
    key.includes(target) ||
    isQueryKeyPrefix(filter, record?.queryKey);
}

function isQueryKeyPrefix(prefix, queryKey) {
  if (!Array.isArray(prefix) || !Array.isArray(queryKey)) {
    return Object.is(prefix, queryKey);
  }

  if (prefix.length > queryKey.length) return false;
  for (let index = 0; index < prefix.length; index++) {
    if (stableHash(prefix[index]) !== stableHash(queryKey[index])) {
      return false;
    }
  }

  return true;
}

function looksHashedKey(value) {
  return (
    typeof value === 'string' &&
    (value.startsWith('array:') ||
      value.startsWith('object:') ||
      value.startsWith('string:') ||
      value.startsWith('number:') ||
      value.startsWith('boolean:') ||
      value.startsWith('undefined') ||
      value.startsWith('null'))
  );
}

function isEntryStaleByTime(updatedAt, staleTime = DEFAULT_STALE_TIME) {
  const stale = Number(staleTime || 0);
  if (stale === Infinity) return false;
  return now() - Number(updatedAt || 0) >= stale;
}

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return number;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function now() {
  return Date.now();
}

function noop() {}
