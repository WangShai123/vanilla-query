import { MaybeAccessor } from "vanilla-signal";
//#region src/core/types.d.ts
type MaybePromise<T> = T | Promise<T>;
type QueryKey = unknown;
type QueryFilter = unknown;
type QueryStatus = 'pending' | 'success' | 'error';
type QueryFetchStatus = 'idle' | 'fetching';
type MaybeQueryAccessor<T = unknown> = MaybeAccessor<T>;
type CacheAdapterName = 'memory' | 'cookie' | 'localStorage' | 'indexedDB';
type CacheAdapterAlias = CacheAdapterName | 'localstorage' | 'local-storage' | 'indexeddb' | 'indexdb' | 'indexDB' | 'indexed-db';
type CacheOperation = 'clear' | 'close' | 'delete' | 'get' | 'hydrate' | 'set';
interface CacheErrorContext {
  adapter: CacheAdapterName;
  key?: string;
  namespace: string;
  operation: CacheOperation;
}
type CacheErrorHandler = (error: unknown, context: CacheErrorContext) => void;
interface BaseCacheAdapterOptions {
  namespace?: string;
  onError?: CacheErrorHandler;
  ttl?: number;
  [option: string]: unknown;
}
interface MemoryCacheOptions extends BaseCacheAdapterOptions {
  max?: number;
  maxAge?: number;
  maxSize?: number;
}
interface CookieCacheOptions extends BaseCacheAdapterOptions {
  driverOptions?: Record<string, unknown>;
}
interface LocalStorageCacheOptions extends BaseCacheAdapterOptions {
  driverOptions?: Record<string, unknown>;
  storage?: Storage;
}
interface IndexedDBCacheOptions extends BaseCacheAdapterOptions {
  driverOptions?: Record<string, unknown>;
}
type CacheAdapterOptions = BaseCacheAdapterOptions | CookieCacheOptions | IndexedDBCacheOptions | LocalStorageCacheOptions | MemoryCacheOptions;
interface QueryState<TData = unknown, TError = unknown> {
  data: TData | undefined;
  latest: TData | undefined;
  error: TError | null;
  failureCount: number;
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
  isPending: boolean;
  isPaused: boolean;
  isStale: boolean;
  isSuccess: boolean;
  status: QueryStatus;
  fetchStatus: QueryFetchStatus;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
  updatedAt: number;
}
interface QueryCacheRecord<TData = unknown, TQueryKey extends QueryKey = QueryKey> {
  data: TData;
  queryKey: TQueryKey;
  updatedAt: number;
  staleTime: number;
  invalidated: boolean;
  meta?: unknown;
}
interface QueryCacheSetOptions {
  ttl: number;
}
interface QueryCacheAdapter {
  name: string;
  key?: string;
  get(key: string): QueryCacheRecord | undefined;
  getAsync?(key: string): Promise<QueryCacheRecord | undefined>;
  set(key: string, record: QueryCacheRecord, options: QueryCacheSetOptions): MaybePromise<void>;
  delete(key: string): MaybePromise<void>;
  clear(): MaybePromise<void>;
  entries(): IterableIterator<[string, QueryCacheRecord]>;
  expiresIn(key: string): number | undefined;
  resize?(maxSize: number): void;
  close?(): MaybePromise<void>;
}
interface QueryCacheOptions {
  enabled?: boolean;
  adapter?: CacheAdapterAlias | QueryCacheAdapter;
  options?: CacheAdapterOptions;
}
interface NormalizedCacheConfig {
  enabled: boolean;
  adapter: CacheAdapterName | QueryCacheAdapter;
  options: CacheAdapterOptions;
  maxSize: number;
  ttl: number;
}
interface QueryClientOptions {
  cache?: boolean | QueryCacheOptions | NormalizedCacheConfig;
}
type NormalizeFn<TQueryFnData = unknown> = (response: unknown) => TQueryFnData | {
  data: TQueryFnData;
};
interface QueryOptions<TData = unknown, TQueryFnData = TData, TQueryKey extends QueryKey = QueryKey, TError = unknown> extends QueryClientOptions {
  client?: QueryClient;
  queryKey?: MaybeQueryAccessor<TQueryKey>;
  queryFn?: QueryFn<TQueryFnData, TQueryKey>;
  enabled?: MaybeQueryAccessor<boolean>;
  initialData?: MaybeQueryAccessor<TData | undefined>;
  keepPreviousData?: boolean;
  refetchOnMount?: boolean | 'always';
  staleTime?: number;
  dedupe?: boolean;
  retry?: number | ((attempt: number, error: TError) => boolean);
  retryDelay?: number | ((attempt: number, error: TError) => number);
  timeout?: number;
  throwErrors?: boolean;
  suspense?: boolean;
  select?: (data: TQueryFnData) => TData;
  normalize?: false | NormalizeFn<TQueryFnData>;
  shouldRetry?: (error: TError, attempt: number) => boolean;
  onSuccess?: (data: TData, context: QueryCallbackContext<TData, TQueryKey>) => void;
  onError?: (error: TError, context: QueryCallbackContext<TData, TQueryKey>) => void;
  onSettled?: (data: TData | undefined, error: TError | null, context: QueryCallbackContext<TData, TQueryKey>) => void;
  cacheConfig?: NormalizedCacheConfig;
}
interface NormalizedQueryOptions<TData = unknown, TQueryFnData = TData, TQueryKey extends QueryKey = QueryKey, TError = unknown> extends QueryOptions<TData, TQueryFnData, TQueryKey, TError> {
  enabled: MaybeQueryAccessor<boolean>;
  initialData: MaybeQueryAccessor<TData | undefined>;
  keepPreviousData: boolean;
  refetchOnMount: boolean | 'always';
  staleTime: number;
  cache: boolean | QueryCacheOptions | NormalizedCacheConfig;
  cacheConfig: NormalizedCacheConfig;
  dedupe: boolean;
  retry: number | ((attempt: number, error: TError) => boolean);
  retryDelay: number | ((attempt: number, error: TError) => number);
  timeout: number;
  throwErrors: boolean;
  suspense: boolean;
  normalize: false | NormalizeFn<TQueryFnData>;
  shouldRetry: (error: TError, attempt: number) => boolean;
}
interface QueryCallbackContext<TData = unknown, TQueryKey extends QueryKey = QueryKey, TError = unknown> {
  query: Query<TData, TQueryKey, TError>;
  queryKey: TQueryKey;
  key: string;
  fromCache?: boolean;
  meta?: unknown;
}
interface ExecuteOptions {
  force?: boolean;
  keepPreviousData?: boolean;
  meta?: unknown;
}
interface MutateOptions {
  cache?: boolean;
  notify?: boolean;
  updatedAt?: number;
  staleTime?: number;
  meta?: unknown;
}
interface FetchQueryOptions<TData = unknown, TQueryFnData = TData, TQueryKey extends QueryKey = QueryKey, TError = unknown> extends QueryOptions<TData, TQueryFnData, TQueryKey, TError> {
  key?: string;
  queryKey: TQueryKey;
  queryFn: QueryFn<TQueryFnData, TQueryKey>;
  force?: boolean;
  getSignal?: (controller: AbortController | undefined) => void;
  meta?: unknown;
}
interface FetchQueryResult<TData = unknown> {
  data: TData;
  updatedAt: number;
  fromCache: boolean;
}
interface Query<TData = unknown, TQueryKey extends QueryKey = QueryKey, TError = unknown> {
  (): TData | undefined;
  state: QueryState<TData, TError>;
  key(): string;
  queryKey(): TQueryKey;
  promise(): Promise<TData | undefined> | null;
  refetch(options?: ExecuteOptions): Promise<TData | undefined>;
  reload(options?: ExecuteOptions): Promise<TData | undefined>;
  retry(): Promise<TData | undefined>;
  mutate(updater: TData | ((previous: TData | undefined) => TData), options?: MutateOptions): TData;
  invalidate(): number;
  remove(): void;
  abort(): void;
  destroy(): void;
  subscribe(callback: (state: QueryState<TData, TError>, snapshot: unknown[]) => void): () => void;
}
interface QueryClient {
  fetchQuery<TData = unknown, TQueryFnData = TData, TQueryKey extends QueryKey = QueryKey, TError = unknown>(options: FetchQueryOptions<TData, TQueryFnData, TQueryKey, TError>): Promise<FetchQueryResult<TData>>;
  prefetchQuery<TData = unknown, TQueryFnData = TData, TQueryKey extends QueryKey = QueryKey, TError = unknown>(options: FetchQueryOptions<TData, TQueryFnData, TQueryKey, TError>): Promise<TData>;
  getQueryData<TData = unknown>(queryKey: QueryKey, cacheOptions?: QueryClientOptions | NormalizedQueryOptions<TData>): TData | undefined;
  getQueryEntry<TData = unknown>(queryKey: QueryKey, cacheOptions?: QueryClientOptions | NormalizedQueryOptions<TData>): (QueryCacheRecord<TData> & {
    isStale: boolean;
  }) | undefined;
  setQueryData<TData = unknown>(queryKey: QueryKey, updater: TData | ((previous: TData | undefined) => TData), cacheOptions?: QueryClientOptions & Pick<QueryOptions<TData>, 'queryKey' | 'staleTime'> & {
    updatedAt?: number;
    meta?: unknown;
  }): TData;
  invalidateQueries(filter?: QueryFilter): number;
  removeQueries(filter?: QueryFilter): number;
  clear(): void;
  subscribe(listener: (event: QueryClientEvent) => void): () => void;
  notify(event: QueryClientEvent): void;
  getCache(cacheOptions?: QueryClientOptions | NormalizedQueryOptions): QueryCacheAdapter;
  hashQueryKey(queryKey: QueryKey): string;
}
type QueryClientEvent = {
  type: 'cache-error';
  error: unknown;
  key?: string;
} | {
  type: 'clear';
} | {
  type: 'error';
  error: unknown;
  key: string;
} | {
  type: 'fetch';
  data: unknown;
  key: string;
} | {
  type: 'invalidate';
  data: unknown;
  key: string;
} | {
  type: 'remove';
  data: unknown;
  key: string;
} | {
  type: 'set';
  data: unknown;
  key: string;
} | {
  type: 'success';
  data: unknown;
  key: string;
  state: QueryState;
};
type QueryFn<TData = unknown, TQueryKey extends QueryKey = QueryKey> = (context: {
  attempt: number;
  queryKey: TQueryKey;
  signal?: AbortSignal;
  meta?: unknown;
}) => MaybePromise<TData>;
//#endregion
//#region src/core/client.d.ts
declare function createQueryClient(options?: QueryClientOptions): QueryClient;
//#endregion
//#region src/core/hash.d.ts
declare function hashQueryKey(queryKey: QueryKey): string;
type HashSeen = WeakMap<object, number> & {
  sizeHint?: number;
};
declare function stableHash(value: unknown, seen?: HashSeen): string;
//#endregion
//#region src/core/query.d.ts
declare const defaultClient: QueryClient;
declare function createQuery<TData = unknown, TQueryFnData = TData, TQueryKey extends QueryKey = QueryKey, TError = unknown>(options: QueryFn<TQueryFnData, TQueryKey> | QueryOptions<TData, TQueryFnData, TQueryKey, TError>): Query<TData, TQueryKey, TError>;
//#endregion
export { type BaseCacheAdapterOptions, type CacheAdapterAlias, type CacheAdapterName, type CacheAdapterOptions, type CacheErrorContext, type CacheErrorHandler, type CacheOperation, type CookieCacheOptions, type ExecuteOptions, type FetchQueryOptions, type FetchQueryResult, type IndexedDBCacheOptions, type LocalStorageCacheOptions, type MaybeQueryAccessor, type MemoryCacheOptions, type MutateOptions, type NormalizeFn, type NormalizedCacheConfig, type Query, type QueryCacheAdapter, type QueryCacheOptions, type QueryCacheRecord, type QueryClient, type QueryClientEvent, type QueryClientOptions, type QueryFetchStatus, type QueryFn, type QueryKey, type QueryState, type QueryStatus, createQuery, createQueryClient, hashQueryKey, defaultClient as queryClient, stableHash };