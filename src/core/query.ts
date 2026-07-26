import { access, createDeepStore, createEffect, untrack } from 'vanilla-signal';

import { isEntryStaleByTime } from './cache.ts';
import { createQueryClient } from './client.ts';
import { hashQueryKey } from './hash.ts';
import { normalizeOptions } from './options.ts';
import { now } from './time.ts';
import type {
  Accessor,
  ExecuteOptions,
  Query,
  QueryFn,
  QueryKey,
  QueryOptions,
  QueryState,
} from './types.ts';

const defaultClient = createQueryClient();

export function createQuery<TData = unknown>(
  options: QueryFn<TData> | QueryOptions<TData>
): Query<TData> {
  if (typeof options === 'function') {
    options = { queryFn: options };
  }

  const rawOptions = options;
  const queryOptions = normalizeOptions<TData>(options);
  const client = queryOptions.client || defaultClient;
  if (typeof queryOptions.queryFn !== 'function') {
    throw new TypeError('createQuery requires a queryFn');
  }
  const queryFn = queryOptions.queryFn as QueryFn<TData>;

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
  }) as QueryState<TData>;

  let requestId = 0;
  let currentKey = '';
  let currentQueryKey: QueryKey = undefined;
  let currentPromise: Promise<TData | undefined> | null = null;
  let currentAbortController: AbortController | undefined | null = null;
  let disposed = false;
  let latestQueryKey: QueryKey = undefined;
  const subscribers = new Set<
    (state: QueryState<TData>, snapshot: unknown[]) => void
  >();

  const query = function readQueryData() {
    if (queryOptions.suspense && state.isPending && currentPromise) {
      throw currentPromise;
    }

    if (queryOptions.throwErrors && state.error) {
      throw state.error;
    }

    return state.data;
  } as Query<TData>;

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
      typeof updater === 'function'
        ? (updater as (previous: TData | undefined) => TData)(state.data)
        : updater;

    applySuccess(nextData, {
      key,
      updatedAt: mutateOptions.updatedAt ?? now(),
      notify: mutateOptions.notify ?? true,
    });

    if (mutateOptions.cache !== false && queryOptions.cacheConfig.enabled) {
      client.setQueryData(key, nextData, {
        ...getClientCacheOptions(),
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

      const entry = queryOptions.cacheConfig.enabled
        ? client.getQueryEntry<TData>(nextKey, getClientCacheOptions())
        : undefined;

      if (entry) {
        applySuccess(entry.data, {
          key: nextKey,
          updatedAt: entry.updatedAt,
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
        }).catch(() => {});
      }
    });
  });

  return query;

  async function execute(executeOptions: ExecuteOptions = {}) {
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

    if (!force && queryOptions.cacheConfig.enabled) {
      const entry = client.getQueryEntry<TData>(key, getClientCacheOptions());
      if (entry && !entry.isStale) {
        applySuccess(entry.data, {
          key,
          updatedAt: entry.updatedAt,
          notify: false,
        });
        return entry.data;
      }
    }

    const fetchId = ++requestId;
    const keepData =
      executeOptions.keepPreviousData ?? queryOptions.keepPreviousData;

    beginFetch({ keepData });

    const task = client.fetchQuery<TData>({
      key,
      queryKey,
      queryFn,
      force,
      dedupe: queryOptions.dedupe,
      ...getClientCacheOptions(),
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

    currentPromise = task.then((result) => result.data);

    try {
      const result = await task;
      if (disposed || fetchId !== requestId) return state.data;

      applySuccess(result.data, {
        key,
        updatedAt: result.updatedAt,
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

  function beginFetch({ keepData }: { keepData: boolean }) {
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

  function applySuccess(
    data: TData,
    {
      key,
      notify,
      updatedAt,
    }: { key: string; notify: boolean; updatedAt: number }
  ) {
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

  function applyError(error: any) {
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

  function setIdleState({ keepData }: { keepData: boolean }) {
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

  function subscribe(
    callback: (state: QueryState<TData>, snapshot: unknown[]) => void
  ) {
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

  function getClientCacheOptions() {
    return rawOptions.cache === undefined
      ? {}
      : { cache: queryOptions.cacheConfig };
  }
}

export { defaultClient as queryClient };

function readQueryKey(options: { queryKey?: Accessor<QueryKey> }) {
  const key = access(options.queryKey);
  return key === undefined ? ['anonymous'] : key;
}

function readEnabled(options: { enabled?: Accessor<boolean> }) {
  return options.enabled !== false && access(options.enabled) !== false;
}

function resolveValue<TValue>(value: Accessor<TValue>) {
  return typeof value === 'function' ? (value as () => TValue)() : value;
}
