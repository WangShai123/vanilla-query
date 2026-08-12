import { normalizeResponse, shouldRetry } from './response.ts';
import { normalizePositiveInteger, normalizePositiveNumber } from './time.ts';
import type {
  CacheAdapterOptions,
  CacheAdapterAlias,
  CacheAdapterName,
  NormalizedCacheConfig,
  NormalizedQueryOptions,
  QueryCacheAdapter,
  QueryCacheOptions,
  QueryClientOptions,
  QueryKey,
  QueryOptions,
} from './types.ts';

export const DEFAULT_CACHE_TIME = 1000 * 60 * 5;
export const DEFAULT_STALE_TIME = 0;
export const DEFAULT_STORAGE_NAMESPACE = 'signal';

export const defaultOptions = {
  enabled: true,
  initialData: undefined,
  keepPreviousData: true,
  refetchOnMount: true,
  staleTime: DEFAULT_STALE_TIME,
  cache: true,
  dedupe: true,
  retry: 0,
  retryDelay: (attempt: number) =>
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

export function normalizeOptions<
  TData = unknown,
  TQueryFnData = TData,
  TQueryKey extends QueryKey = QueryKey,
  TError = unknown,
>(
  options: QueryOptions<TData, TQueryFnData, TQueryKey, TError> = {}
): NormalizedQueryOptions<TData, TQueryFnData, TQueryKey, TError> {
  const cacheConfig = normalizeCacheConfig(options);

  return {
    ...defaultOptions,
    ...options,
    cache: options.cache ?? defaultOptions.cache,
    cacheConfig,
    staleTime:
      options.staleTime ??
      cacheConfig.options.staleTime ??
      defaultOptions.staleTime,
  } as NormalizedQueryOptions<TData, TQueryFnData, TQueryKey, TError>;
}

export function normalizeClientOptions(options: QueryClientOptions = {}) {
  const cacheConfig = normalizeCacheConfig(options);

  return {
    ...options,
    cacheConfig,
  };
}

export function normalizeCacheConfig(
  options:
    | NormalizedQueryOptions<unknown, unknown, QueryKey, unknown>
    | QueryClientOptions
    | QueryOptions<unknown, unknown, QueryKey, unknown> = {},
  fallback?: { cacheConfig?: NormalizedCacheConfig }
): NormalizedCacheConfig {
  if ('cacheConfig' in options && options.cacheConfig) {
    return options.cacheConfig;
  }

  const rawCache = options.cache;
  const shouldInheritFallback = rawCache === undefined;
  const rawCacheOptions =
    rawCache && typeof rawCache === 'object'
      ? (rawCache as QueryCacheOptions | NormalizedCacheConfig)
      : undefined;
  const adapter = normalizeCacheAdapter(
    rawCacheOptions?.adapter ??
      (shouldInheritFallback ? fallback?.cacheConfig?.adapter : undefined) ??
      'memory'
  );
  const adapterOptions = normalizeCacheAdapterOptions(
    adapter,
    rawCacheOptions,
    shouldInheritFallback ? fallback : undefined
  );
  const enabled =
    rawCache === undefined
      ? (fallback?.cacheConfig?.enabled ?? true)
      : rawCache === true
        ? true
        : rawCache === false
          ? false
          : rawCacheOptions?.enabled !== false;
  const ttl = normalizePositiveNumber(adapterOptions.ttl, DEFAULT_CACHE_TIME);
  const maxSize = normalizePositiveInteger(
    adapterOptions.maxSize ?? adapterOptions.max,
    100
  );

  return {
    enabled,
    adapter,
    options: adapterOptions,
    maxSize,
    ttl,
  };
}

export function normalizeCacheAdapter(
  adapter: CacheAdapterAlias | QueryCacheAdapter | undefined
) {
  if (adapter && typeof adapter !== 'string') return adapter;

  const name = adapter ?? 'memory';
  if (name === 'localstorage' || name === 'local-storage') {
    return 'localStorage';
  }
  if (
    name === 'indexeddb' ||
    name === 'indexdb' ||
    name === 'indexDB' ||
    name === 'indexed-db'
  ) {
    return 'indexedDB';
  }

  return name as CacheAdapterName;
}

export function getCacheIdentity(config: NormalizedCacheConfig) {
  const adapterName =
    typeof config.adapter === 'string'
      ? config.adapter
      : (config.adapter.name ?? 'custom');
  const namespace = config.options.namespace ?? DEFAULT_STORAGE_NAMESPACE;
  return `${adapterName}:${namespace}`;
}

function normalizeCacheAdapterOptions(
  adapter: CacheAdapterName | QueryCacheAdapter,
  cacheOptions: QueryCacheOptions | NormalizedCacheConfig | undefined,
  fallback?: { cacheConfig?: NormalizedCacheConfig }
): CacheAdapterOptions & {
  max?: number;
  maxAge?: number;
  maxSize?: number;
  ttl?: number;
} {
  const defaults = getDefaultCacheAdapterOptions(adapter);
  const options = {
    ...defaults,
    ...fallback?.cacheConfig?.options,
    ...cacheOptions?.options,
  } as CacheAdapterOptions & Record<string, unknown>;

  return {
    ...options,
    maxSize:
      toOptionalNumber(options.maxSize ?? options.max) ?? defaults.maxSize,
    max: toOptionalNumber(options.max ?? options.maxSize) ?? defaults.max,
    maxAge: toOptionalNumber(options.maxAge ?? options.ttl) ?? defaults.maxAge,
    ttl: toOptionalNumber(options.ttl ?? options.maxAge) ?? defaults.ttl,
  };
}

function getDefaultCacheAdapterOptions(
  adapter: CacheAdapterName | QueryCacheAdapter
) {
  const base = {
    maxSize: 100,
    max: 100,
    maxAge: DEFAULT_CACHE_TIME,
    namespace: DEFAULT_STORAGE_NAMESPACE,
    ttl: DEFAULT_CACHE_TIME,
  };

  if (adapter === 'cookie') {
    return {
      ...base,
      driverOptions: {
        path: '/',
        sameSite: 'lax',
      },
    };
  }

  if (adapter === 'indexedDB') {
    return {
      ...base,
      driverOptions: {
        dbName: 'VanillaQuery',
        storeName: 'queries',
      },
    };
  }

  return base;
}

function toOptionalNumber(value: unknown) {
  return typeof value === 'number' ? value : undefined;
}
