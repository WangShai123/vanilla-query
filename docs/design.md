# Vanilla Query Design Documentation

## Design Principles

`vanilla-query` focuses on server-side state management. It only handles requests, caching, state, invalidation, and request lifecycle, without binding to DOM rendering or prescribing UI organization patterns.

Core principles:

- Data layer independence: queries do not directly manipulate the DOM.
- Observable state: each query exposes a reactive `state`.
- Shareable cache: identical `queryKey` can reuse cached data and pending requests.
- Controlled refresh: control data freshness through `staleTime`, `cacheTime`, and `invalidateQueries`.
- Request safety: handle cancellation, timeouts, retries, and race conditions via AbortController, timeout, retry mechanisms, and request IDs.

## Architecture

The current project consists of two layers:

- `createQuery(options)`: A single business request instance responsible for parsing `queryKey`, maintaining state, triggering requests, and exposing control methods.
- `createQueryClient(options)`: Cache and request coordinator responsible for LRU caching, pending request deduplication, prefetching, invalidation, deletion, and event notifications.

A shared `queryClient` is provided by default. If you need isolated caching, you can create an independent client:

```js
const client = createQueryClient({
  cacheMax: 300,
  cacheTime: 10 * 60_000,
});
```

## createQuery Return Value

`createQuery` returns a function:

```js
const query = createQuery({
  queryKey: ['products'],
  queryFn: fetchProducts,
});

query(); // Current data
query.state; // Current state
query.refetch(); // Control method
```

This design keeps data reading simple while consolidating state and control methods in the same query object.

## State Model

`status` describes the data result:

- `pending`: No successful data yet.
- `success`: Successful data available.
- `error`: Most recent request failed.

`fetchStatus` describes the request process:

- `idle`: No request in progress.
- `fetching`: Request in progress.

Thus, it can express the state of "having data but refreshing":

```js
query.state.status === 'success';
query.state.fetchStatus === 'fetching';
query.state.isStale === true;
```

Common boolean states:

- `isPending`: No successful data yet.
- `isLoading`: No displayable data and currently requesting.
- `isFetching`: Currently requesting.
- `isStale`: Current data has expired, or waiting for new results using old data.
- `isSuccess`: Currently has successful data.
- `isError`: Most recent request failed.
- `isPaused`: Query is currently disabled.

## queryKey

`queryKey` is the request identity that determines caching, deduplication, and invalidation.

Arrays are recommended:

```js
['products', { page: 1, keyword: 'phone' }];
```

Object fields are stably sorted, so the following two keys are equivalent:

```js
['products', { page: 1, keyword: 'phone' }];
['products', { keyword: 'phone', page: 1 }];
```

Array keys also support prefix invalidation:

```js
queryClient.invalidateQueries(['products']);
```

This can match:

```js
['products', 1];
['products', 2];
['products', { keyword: 'phone' }];
```

## Cache Model

Cache record structure:

```js
{
  data,
  queryKey,
  updatedAt,
  staleTime,
  invalidated,
  meta,
}
```

Cache freshness:

```js
isStale = invalidated || Date.now() - updatedAt >= staleTime;
```

Cache retention is managed by LRU:

- `cacheMax` controls the maximum number of records.
- `cacheTime` controls record retention time.
- `staleTime` controls data freshness duration.

When fresh cache hits, the query uses the cache directly. When stale cache hits, the query can display old data first, then initiate background refresh.

## Request Model

Request flow:

1. Parse `queryKey` and `enabled`.
2. If fresh cache hits, write directly to state.
3. If stale cache hits, display old data first, then make background request.
4. If no displayable data, enter loading state.
5. Client deduplicates pending requests by hash key.
6. Execute `normalize` and `select` after successful request.
7. Write to state and cache.
8. Retry according to retry strategy after request failure.
9. Write to error state on final failure.
10. Ignore results from expired requests via request ID.

## Error Model

Default normalize supports `{ success, data, message, code }` style responses.

```js
{ success: true, data: [] }
{ success: false, message: 'No access', code: 'NO_ACCESS' }
```

`success: false` is converted to `BusinessError`.

You can also customize `normalize`:

```js
createQuery({
  normalize(response) {
    if (response.errno !== 0) {
      throw new Error(response.errmsg);
    }

    return { data: response.result };
  },
  queryFn,
});
```

## Extension Points

Common extension methods:

- `queryClient.subscribe(listener)`: Listen to cache and request events.
- `onSuccess`, `onError`, `onSettled`: Listen to individual query lifecycle.
- `normalize`: Unify business response structure.
- `select`: Derive final data from response data.
- Custom `retry`, `retryDelay`, `shouldRetry`: Control failure retry strategies.
