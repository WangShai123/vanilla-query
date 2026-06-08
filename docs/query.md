# Vanilla Query Documentation

`vanilla-query` is an asynchronous state management library designed for native JavaScript business request scenarios. It provides reactive request states, LRU caching, request deduplication, retry mechanisms, timeout handling, cancellation, prefetching, and cache invalidation capabilities.

## Design Goals

- Independent data layer: Only handles requests, caching, state, and invalidation without binding to DOM rendering.
- Functional API: Uses `createQuery` to return a callable data accessor; read data by directly calling `query()`.
- Business-request friendly: Built-in support for commonly used page capabilities like `status`, `isLoading`, `isFetching`, `isStale`, `failureCount`, `refetch`, `retry`, and `mutate`.
- Cross-instance caching: Same `queryKey` shares LRU cache and pending requests.
- Controlled consistency: Supports `staleTime`, `cacheTime`, `invalidateQueries`, `removeQueries`, and `prefetchQuery`.
- Request safety: Supports AbortController, timeout, request deduplication, retry mechanisms, and race condition protection.

## createQuery Form

`createQuery` returns a callable function. The function itself is used to read current data, with state and control methods attached to the function object:

```js
const user = createQuery({
  queryKey: ['user', userId],
  queryFn: async ({ queryKey, signal }) => {
    const response = await fetch(`/api/users/${queryKey[1]}`, { signal });
    return response.json();
  },
});

user(); // Current data
user.state.status;
user.refetch();
```

This form places "reading data" and "controlling requests" on the same query object, suitable for business requests like lists, details, search, and dashboard cards.

## Installation and Import

```js
import { createQuery, queryClient, createQueryClient } from 'vanilla-query';
```

In browser native modules, you can import the bundled `dist/index.mjs`.

## Basic Usage

```js
const products = createQuery({
  queryKey: ['products'],
  queryFn: async ({ signal }) => {
    const response = await fetch('/api/products', { signal });
    return response.json();
  },
});

createEffect(() => {
  if (products.state.isLoading) {
    console.log('loading');
    return;
  }

  if (products.state.isError) {
    console.error(products.state.error);
    return;
  }

  console.log(products());
});
```

After `createQuery` is created, it executes automatically by default. The return value is a function; call it to read the current `data`.

## State Fields

```js
query.state.data;
query.state.latest;
query.state.error;
query.state.failureCount;
query.state.status; // pending | success | error
query.state.fetchStatus; // idle | fetching
query.state.isPending;
query.state.isLoading;
query.state.isFetching;
query.state.isStale;
query.state.isSuccess;
query.state.isError;
query.state.isPaused;
query.state.dataUpdatedAt;
query.state.errorUpdatedAt;
query.state.updatedAt;
```

Common distinctions:

- `isLoading`: Currently no displayable data and requesting.
- `isFetching`: Currently requesting, which could be initial loading or background refresh.
- `isStale`: Current data is displayable but has expired or is waiting for new results using old data.
- `status`: Describes the data result state.
- `fetchStatus`: Describes the request process state.

## queryKey

`queryKey` is used for caching, deduplication, and invalidation. Arrays are recommended:

```js
createQuery({
  queryKey: ['products', { page: 1, keyword: 'phone' }],
  queryFn,
});
```

Object keys are stably sorted, so the following two keys are equivalent:

```js
['products', { page: 1, keyword: 'phone' }];
['products', { keyword: 'phone', page: 1 }];
```

`queryKey` can be a reactive accessor:

```js
const [page, setPage] = createSignal(1);

const list = createQuery({
  queryKey: () => ['products', page()],
  keepPreviousData: true,
  queryFn: ({ queryKey }) => fetchPage(queryKey[1]),
});
```

When `page()` changes, the query automatically switches keys and requests new data.

## queryFn

```js
queryFn({
  queryKey,
  attempt,
  signal,
  meta,
});
```

- `queryKey`: The current parsed key.
- `attempt`: Which attempt number, starting from 1.
- `signal`: Used to cancel fetch.
- `meta`: Additional information passed via `refetch({ meta })` or `prefetchQuery({ meta })`.

## Common Methods

```js
query.refetch(); // Force background refresh, keeps old data by default
query.reload(); // Force reload, doesn't keep old data by default
query.retry(); // Force another request
query.mutate(updater); // Local update and write to cache
query.invalidate(); // Mark current query cache as stale
query.remove(); // Delete current cache and reset state
query.abort(); // Abort current request and ignore old results
query.destroy(); // Destroy reactive effects and requests
query.promise(); // Current pending promise
query.key(); // Current hash key
query.queryKey(); // Current original queryKey
query.subscribe((state) => {});
```

## Caching Strategy

Caching is enabled by default:

```js
createQuery({
  queryKey: ['user', 1],
  staleTime: 1000 * 30,
  cacheTime: 1000 * 60 * 5,
  cacheMax: 100,
  queryFn,
});
```

- `staleTime`: Duration data remains fresh. Default is `0`, meaning immediately available for background refresh after success.
- `cacheTime`: Cache record retention time. Default is 5 minutes.
- `cacheMax`: Maximum LRU cache entries. Default is 100.
- `cache: false`: Disable caching.

Example:

```js
const user = createQuery({
  queryKey: ['user', id],
  staleTime: 60_000,
  cacheTime: 10 * 60_000,
  queryFn,
});
```

Creating a query with the same key within one minute will use the cache directly; after ten minutes, the cache expires via LRU.

## Query Client

The default export is `queryClient`, or you can create an independent client:

```js
const client = createQueryClient({
  cacheMax: 300,
  cacheTime: 10 * 60_000,
});

const query = createQuery({
  client,
  queryKey: ['orders'],
  queryFn,
});
```

### Prefetching

```js
await queryClient.prefetchQuery({
  queryKey: ['product', 1],
  staleTime: 60_000,
  queryFn: () => fetchProduct(1),
});
```

### Reading and Writing Cache

```js
queryClient.getQueryData(['product', 1]);

queryClient.setQueryData(['product', 1], (previous) => ({
  ...previous,
  liked: true,
}));
```

### Invalidation and Deletion

```js
queryClient.invalidateQueries(['products']);
queryClient.removeQueries(['products', 1]);
queryClient.clear();
```

Array filter supports prefix matching; `["products"]` can match `["products", 1]`, `["products", 2]`.

### Listening to Client Events

```js
const unsubscribe = queryClient.subscribe((event) => {
  console.log(event.type, event.key);
});
```

Event types include `set`, `fetch`, `success`, `error`, `invalidate`, `remove`, and `clear`.

## Retry

```js
createQuery({
  queryKey: ['report'],
  retry: 2,
  retryDelay: (attempt) => attempt * 500,
  queryFn,
});
```

By default, 4xx errors and `AbortError` are not retried. You can customize:

```js
createQuery({
  retry: (attempt, error) => attempt < 3 && error.status >= 500,
  shouldRetry: (error) => error.name !== 'AbortError',
  queryFn,
});
```

## Timeout and Abort

```js
const query = createQuery({
  queryKey: ['slow'],
  timeout: 8000,
  queryFn: ({ signal }) => fetch('/api/slow', { signal }).then((r) => r.json()),
});

query.abort();
```

Request timeout throws a `TimeoutError` and attempts to abort the current request.

## Business Response Normalization

Default support for `{ success, data, message, code }` style responses:

```js
{ success: true, data: [...] }
{ success: false, message: "No access", code: "NO_ACCESS" }
```

`success: false` is converted to `BusinessError`.

If the backend structure differs, you can pass `normalize`:

```js
createQuery({
  queryKey: ['items'],
  normalize(response) {
    if (response.errno !== 0) {
      throw new Error(response.errmsg);
    }

    return { data: response.result };
  },
  queryFn,
});
```

Disable normalization:

```js
createQuery({
  normalize: false,
  queryFn,
});
```

## select

`select` is used to derive final data written to state/cache from response data:

```js
createQuery({
  queryKey: ['users'],
  queryFn: fetchUsers,
  select: (users) => users.filter((user) => user.active),
});
```

## enabled

`enabled` can be a boolean value or an accessor:

```js
const [id, setId] = createSignal(null);

const user = createQuery({
  enabled: () => id() !== null,
  queryKey: () => ['user', id()],
  queryFn,
});
```

When disabled, automatic requests won't occur, and `state.isPaused` is `true`. Manual `refetch()` forces a request.

## Suspense and throwErrors

```js
createQuery({
  suspense: true,
  throwErrors: true,
  queryFn,
});
```

- `suspense: true`: When reading `query()`, if the initial request is still pending, it throws the current Promise.
- `throwErrors: true`: When reading `query()`, if there's an error, it throws the current error.

For regular business pages, directly reading `query.state` is more recommended.

## Use Cases

`createQuery` is suitable for managing business data that needs synchronization with the server:

- Lists, details, search, pagination, filtering.
- Multiple UI areas reading the same interface data.
- Needs for caching, prefetching, deduplication, invalidation, or optimistic updates.
- Unified handling of loading, refreshing, error, and retry states.

`vanilla-query` does not handle DOM rendering. The UI layer only consumes `query()` and `query.state`; the rendering approach is determined by the application itself.
