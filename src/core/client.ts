import {
  createQueryCacheAdapter,
  toReadableCacheEntry,
  writeCache,
  writeCacheInBackground,
} from './cache.ts';
import { createMatcher, hashQueryKey, looksHashedKey } from './hash.ts';
import {
  getCacheIdentity,
  normalizeCacheConfig,
  normalizeClientOptions,
} from './options.ts';
import {
  canRetry,
  normalizeResult,
  resolveRetryDelay,
  withTimeout,
} from './response.ts';
import { normalizePositiveNumber, now, sleep } from './time.ts';
import type {
  FetchQueryOptions,
  FetchQueryResult,
  NormalizedQueryOptions,
  QueryKey,
  QueryCacheAdapter,
  QueryCacheRecord,
  QueryClient,
  QueryClientEvent,
  QueryClientOptions,
  QueryFilter,
  QueryOptions,
} from './types.ts';

export function createQueryClient(
  options: QueryClientOptions = {}
): QueryClient {
  const clientOptions = normalizeClientOptions(options);
  const caches = new Map<string, QueryCacheAdapter>();
  const pendingRequests = new Map<string, Promise<FetchQueryResult<unknown>>>();
  const listeners = new Set<(event: QueryClientEvent) => void>();

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

  function getCache(
    cacheOptions:
      | NormalizedQueryOptions<unknown, unknown, QueryKey, unknown>
      | QueryClientOptions = {}
  ): QueryCacheAdapter {
    const config = normalizeCacheConfig(cacheOptions, clientOptions);
    const cacheId = getCacheIdentity(config);
    const existing = caches.get(cacheId);

    if (existing) {
      existing.resize?.(config.maxSize);
      return existing;
    }

    const cache = createQueryCacheAdapter(config);
    caches.set(cacheId, cache);
    return cache;
  }

  async function fetchQuery<
    TData = unknown,
    TQueryFnData = TData,
    TQueryKey extends QueryKey = QueryKey,
    TError = unknown,
  >(
    options: FetchQueryOptions<TData, TQueryFnData, TQueryKey, TError>
  ): Promise<FetchQueryResult<TData>> {
    const key = options.key ?? hashQueryKey(options.queryKey);
    const cacheConfig = normalizeCacheConfig(options, clientOptions);
    const cacheEnabled = cacheConfig.enabled;

    if (!options.force && cacheEnabled) {
      const entry = await getQueryEntryAsync<TData>(key, options);
      if (entry && !entry.isStale) {
        return {
          data: entry.data,
          updatedAt: entry.updatedAt,
          fromCache: true,
        };
      }
    }

    if (options.dedupe !== false && pendingRequests.has(key)) {
      return pendingRequests.get(key) as Promise<FetchQueryResult<TData>>;
    }

    const promise = runFetch<TData, TQueryFnData, TQueryKey, TError>(key, {
      ...options,
      cache: cacheConfig,
    });
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

  async function prefetchQuery<
    TData = unknown,
    TQueryFnData = TData,
    TQueryKey extends QueryKey = QueryKey,
    TError = unknown,
  >(
    options: FetchQueryOptions<TData, TQueryFnData, TQueryKey, TError>
  ): Promise<TData> {
    const result = await fetchQuery({
      ...options,
      force: options.force ?? false,
      dedupe: options.dedupe ?? true,
    });
    return result.data;
  }

  function getQueryData<TData = unknown>(
    queryKey: unknown,
    cacheOptions:
      | NormalizedQueryOptions<TData, unknown, QueryKey, unknown>
      | QueryClientOptions = {}
  ) {
    return getQueryEntry<TData>(queryKey, cacheOptions)?.data;
  }

  function getQueryEntry<TData = unknown>(
    queryKey: unknown,
    cacheOptions:
      | NormalizedQueryOptions<TData, unknown, QueryKey, unknown>
      | QueryClientOptions = {}
  ) {
    if (!normalizeCacheConfig(cacheOptions, clientOptions).enabled) {
      return undefined;
    }

    const key = looksHashedKey(queryKey) ? queryKey : hashQueryKey(queryKey);
    const cache = getCache(cacheOptions);
    return toReadableCacheEntry<TData>(cache.get(key));
  }

  async function getQueryEntryAsync<TData = unknown>(
    queryKey: unknown,
    cacheOptions:
      | NormalizedQueryOptions<TData, unknown, QueryKey, unknown>
      | QueryClientOptions = {}
  ) {
    if (!normalizeCacheConfig(cacheOptions, clientOptions).enabled) {
      return undefined;
    }

    const key = looksHashedKey(queryKey) ? queryKey : hashQueryKey(queryKey);
    const cache = getCache(cacheOptions);
    let record: QueryCacheRecord | undefined;

    try {
      record = cache.get(key) ?? (await cache.getAsync?.(key));
    } catch (error) {
      handleCacheError(error, key);
      return undefined;
    }

    return toReadableCacheEntry<TData>(record);
  }

  function setQueryData<TData = unknown>(
    queryKey: unknown,
    updater: TData | ((previous: TData | undefined) => TData),
    cacheOptions: QueryClientOptions &
      Pick<QueryOptions<TData>, 'queryKey' | 'staleTime'> & {
        updatedAt?: number;
        meta?: unknown;
      } = {}
  ): TData {
    const key = looksHashedKey(queryKey) ? queryKey : hashQueryKey(queryKey);
    const previous = getQueryEntry<TData>(key, cacheOptions)?.data;
    const data =
      typeof updater === 'function'
        ? (updater as (previous: TData | undefined) => TData)(previous)
        : updater;
    const record = createCacheRecord(data, cacheOptions);
    const cacheConfig = normalizeCacheConfig(cacheOptions, clientOptions);
    if (!cacheConfig.enabled) return data;

    const ttl = normalizePositiveNumber(
      cacheConfig.ttl,
      clientOptions.cacheConfig.ttl
    );
    const cache = getCache(cacheOptions);

    writeCacheInBackground(cache, key, record, { ttl }, (error) => {
      handleCacheError(error, key);
    });
    notify({ type: 'set', key, data });
    return data;
  }

  function invalidateQueries(filter?: QueryFilter) {
    let count = 0;

    forEachCacheEntry(filter, (cache, key, record) => {
      const ttl = Math.max(
        cache.expiresIn(key) ?? clientOptions.cacheConfig.ttl,
        1
      );
      void Promise.resolve(
        cache.set(
          key,
          {
            ...record,
            invalidated: true,
          },
          { ttl }
        )
      ).catch((error) => {
        handleCacheError(error, key);
      });
      count += 1;
      notify({ type: 'invalidate', key, data: record.data });
    });

    return count;
  }

  function removeQueries(filter?: QueryFilter) {
    let count = 0;

    forEachCacheEntry(filter, (cache, key, record) => {
      void Promise.resolve(cache.delete(key)).catch((error) => {
        handleCacheError(error, key);
      });
      pendingRequests.delete(key);
      count += 1;
      notify({ type: 'remove', key, data: record.data });
    });

    return count;
  }

  function clear() {
    caches.forEach((cache) => {
      void Promise.resolve(cache.clear()).catch((error) => {
        handleCacheError(error);
      });
      void Promise.resolve(cache.close?.()).catch((error) => {
        handleCacheError(error);
      });
    });
    caches.clear();
    pendingRequests.clear();
    notify({ type: 'clear' });
  }

  function subscribe(listener: (event: QueryClientEvent) => void) {
    if (typeof listener !== 'function') {
      throw new TypeError('queryClient.subscribe requires a listener');
    }

    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function notify(event: QueryClientEvent) {
    listeners.forEach((listener) => listener(event));
  }

  async function runFetch<
    TData = unknown,
    TQueryFnData = TData,
    TQueryKey extends QueryKey = QueryKey,
    TError = unknown,
  >(
    key: string,
    options: FetchQueryOptions<TData, TQueryFnData, TQueryKey, TError>
  ): Promise<FetchQueryResult<TData>> {
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
        const normalized = normalizeResult<TQueryFnData>(
          raw,
          options.normalize
        );
        const selected =
          typeof options.select === 'function'
            ? options.select(normalized.data)
            : (normalized.data as unknown as TData);
        const updatedAt = now();

        if (normalizeCacheConfig(options, clientOptions).enabled) {
          try {
            await writeQueryData(key, selected, {
              cache: options.cache,
              staleTime: options.staleTime,
              updatedAt,
              queryKey: options.queryKey,
              meta: options.meta,
            });
          } catch (error) {
            handleCacheError(error, key);
          }
        }

        notify({ type: 'fetch', key, data: selected });
        return {
          data: selected,
          updatedAt,
          fromCache: false,
        };
      } catch (error) {
        if (!canRetry(error as TError, attempt, options)) {
          notify({ type: 'error', key, error });
          throw error;
        }

        await sleep(
          resolveRetryDelay(options.retryDelay, attempt, error as TError)
        );
      }
    }
  }

  async function writeQueryData<TData = unknown>(
    key: string,
    data: TData,
    cacheOptions: QueryClientOptions &
      Pick<QueryOptions<TData>, 'queryKey' | 'staleTime'> & {
        updatedAt?: number;
        meta?: unknown;
      }
  ) {
    const cacheConfig = normalizeCacheConfig(cacheOptions, clientOptions);
    const ttl = normalizePositiveNumber(
      cacheConfig.ttl,
      clientOptions.cacheConfig.ttl
    );
    const cache = getCache(cacheOptions);
    await writeCache(cache, key, createCacheRecord(data, cacheOptions), {
      ttl,
    });
  }

  function forEachCacheEntry(
    filter: QueryFilter,
    callback: (
      cache: QueryCacheAdapter,
      key: string,
      record: QueryCacheRecord
    ) => void
  ) {
    const matcher = createMatcher(filter);

    caches.forEach((cache) => {
      for (const [key, record] of cache.entries()) {
        if (matcher(key, record)) {
          callback(cache, key, record);
        }
      }
    });
  }

  function handleCacheError(error: unknown, key?: string) {
    notify({ type: 'cache-error', key, error });
  }
}

function createCacheRecord<TData = unknown>(
  data: TData,
  cacheOptions: Pick<QueryOptions<TData>, 'queryKey' | 'staleTime'> & {
    updatedAt?: number;
    meta?: unknown;
  }
) {
  return {
    data,
    queryKey: cacheOptions.queryKey,
    updatedAt: cacheOptions.updatedAt ?? now(),
    staleTime: cacheOptions.staleTime ?? 0,
    invalidated: false,
    meta: cacheOptions.meta,
  };
}
