//#region src/core/types.d.ts
type MaybePromise<T> = T | Promise<T>;
type Accessor<T> = T | (() => T);
type QueryKey = unknown;
type QueryFilter = unknown;
type QueryStatus = 'pending' | 'success' | 'error';
type QueryFetchStatus = 'idle' | 'fetching';
type CacheAdapterName = 'memory' | 'cookie' | 'localStorage' | 'indexedDB';
type CacheAdapterAlias = CacheAdapterName | 'localstorage' | 'local-storage' | 'indexeddb' | 'indexdb' | 'indexDB' | 'indexed-db';
interface QueryState<TData = unknown> {
  data: TData | undefined;
  latest: TData | undefined;
  error: any;
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
interface QueryCacheRecord<TData = unknown> {
  data: TData;
  queryKey: QueryKey;
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
  options?: Record<string, any>;
}
interface NormalizedCacheConfig {
  enabled: boolean;
  adapter: CacheAdapterName | QueryCacheAdapter;
  options: Record<string, any>;
  maxSize: number;
  ttl: number;
}
interface QueryClientOptions {
  cache?: boolean | QueryCacheOptions | NormalizedCacheConfig;
}
interface QueryOptions<TData = unknown> extends QueryClientOptions {
  client?: QueryClient;
  queryKey?: Accessor<QueryKey>;
  queryFn?: QueryFn<TData>;
  enabled?: Accessor<boolean>;
  initialData?: Accessor<TData | undefined>;
  keepPreviousData?: boolean;
  refetchOnMount?: boolean | 'always';
  staleTime?: number;
  dedupe?: boolean;
  retry?: number | ((attempt: number, error: any) => boolean);
  retryDelay?: number | ((attempt: number, error: any) => number);
  timeout?: number;
  throwErrors?: boolean;
  suspense?: boolean;
  select?: (data: any) => TData;
  normalize?: false | ((response: unknown) => unknown);
  shouldRetry?: (error: any, attempt: number) => boolean;
  onSuccess?: (data: TData, context: QueryCallbackContext<TData>) => void;
  onError?: (error: any, context: QueryCallbackContext<TData>) => void;
  onSettled?: (data: TData | undefined, error: any, context: QueryCallbackContext<TData>) => void;
  cacheConfig?: NormalizedCacheConfig;
}
interface NormalizedQueryOptions<TData = unknown> extends QueryOptions<TData> {
  enabled: Accessor<boolean>;
  initialData: Accessor<TData | undefined>;
  keepPreviousData: boolean;
  refetchOnMount: boolean | 'always';
  staleTime: number;
  cache: boolean | QueryCacheOptions | NormalizedCacheConfig;
  cacheConfig: NormalizedCacheConfig;
  dedupe: boolean;
  retry: number | ((attempt: number, error: any) => boolean);
  retryDelay: number | ((attempt: number, error: any) => number);
  timeout: number;
  throwErrors: boolean;
  suspense: boolean;
  normalize: false | ((response: unknown) => unknown);
  shouldRetry: (error: any, attempt: number) => boolean;
}
interface QueryCallbackContext<TData = unknown> {
  query: Query<TData>;
  queryKey: QueryKey;
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
interface FetchQueryOptions<TData = unknown> extends QueryOptions<TData> {
  key?: string;
  queryKey: QueryKey;
  queryFn: QueryFn<TData>;
  force?: boolean;
  getSignal?: (controller: AbortController | undefined) => void;
  meta?: unknown;
}
interface FetchQueryResult<TData = unknown> {
  data: TData;
  updatedAt: number;
  fromCache: boolean;
}
interface Query<TData = unknown> {
  (): TData | undefined;
  state: QueryState<TData>;
  key(): string;
  queryKey(): QueryKey;
  promise(): Promise<TData | undefined> | null;
  refetch(options?: ExecuteOptions): Promise<TData | undefined>;
  reload(options?: ExecuteOptions): Promise<TData | undefined>;
  retry(): Promise<TData | undefined>;
  mutate(updater: TData | ((previous: TData | undefined) => TData), options?: MutateOptions): TData;
  invalidate(): number;
  remove(): void;
  abort(): void;
  destroy(): void;
  subscribe(callback: (state: QueryState<TData>, snapshot: unknown[]) => void): () => void;
}
interface QueryClient {
  fetchQuery<TData = unknown>(options: FetchQueryOptions<TData>): Promise<FetchQueryResult<TData>>;
  prefetchQuery<TData = unknown>(options: FetchQueryOptions<TData>): Promise<TData>;
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
interface QueryClientEvent {
  type: 'cache-error' | 'clear' | 'error' | 'fetch' | 'invalidate' | 'remove' | 'set' | 'success';
  key?: string;
  data?: unknown;
  error?: unknown;
  state?: QueryState;
}
type QueryFn<TData = unknown> = (context: {
  attempt: number;
  queryKey: QueryKey;
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
declare function createQuery<TData = unknown>(options: QueryFn<TData> | QueryOptions<TData>): Query<TData>;
//#endregion
export { type CacheAdapterAlias, type CacheAdapterName, type ExecuteOptions, type FetchQueryOptions, type FetchQueryResult, type MutateOptions, type NormalizedCacheConfig, type Query, type QueryCacheAdapter, type QueryCacheOptions, type QueryCacheRecord, type QueryClient, type QueryClientEvent, type QueryClientOptions, type QueryFetchStatus, type QueryFn, type QueryKey, type QueryState, type QueryStatus, createQuery, createQueryClient, hashQueryKey, defaultClient as queryClient, stableHash };