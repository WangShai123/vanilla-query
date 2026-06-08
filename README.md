# Vanilla Query

`vanilla-query` is a small server-state and async query runtime for vanilla JavaScript. It provides reactive query state, LRU cache, stale refresh, request dedupe, retry, timeout, abort, prefetch and cache invalidation.

It is designed to work with [`vanilla-signal`](https://github.com/WangShai123/vanilla-signal):

```js
import { createEffect } from 'vanilla-signal';
import { createQuery } from 'vanilla-signal-query';

const profile = createQuery({
  queryKey: ['profile'],
  queryFn: async ({ signal }) => {
    const response = await fetch('/api/profile', { signal });
    return response.json();
  },
});

createEffect(() => {
  if (profile.state.isLoading) return;
  if (profile.state.isError) return console.error(profile.state.error);

  console.log(profile());
});
```

## Npm Package Name Changed

Due to npm package name conflict, the package name has been changed to `vanilla-signal-query`.

## Install

npm:

```bash
npm install vanilla-signal-query
```

script:

```html
<!-- umd GlobalName: query -->
<script src="https://unpkg.com/vanilla-signal-query/dist/index.umd.js"></script>
<script>
  const { createQuery } = query;
</script>

<!-- es module -->
<script type="module">
  import { createQuery } from 'https://unpkg.com/vanilla-signal-query/dist/index.mjs';
</script>
```

## Core API

- `createQuery(options)`: creates a reactive query accessor.
- `queryClient`: default shared query client.
- `createQueryClient(options)`: creates an isolated cache/request client.
- `stableHash(value)` and `hashQueryKey(queryKey)`: stable query-key helpers.

## Query Options

```js
createQuery({
  queryKey: ['products', { page: 1 }],
  queryFn: async ({ queryKey, signal, attempt, meta }) => {},
  enabled: true,
  initialData: undefined,
  keepPreviousData: true,
  staleTime: 0,
  cacheTime: 5 * 60 * 1000,
  cacheMax: 100,
  retry: 0,
  retryDelay: (attempt) => Math.min(1000 * 2 ** (attempt - 1), 30000),
  timeout: 0,
  select: (data) => data,
  normalize: (response) => ({ data: response }),
});
```

## Query Methods

```js
query(); // data
query.state; // reactive deep store
query.refetch();
query.reload();
query.retry();
query.mutate((previous) => next);
query.invalidate();
query.remove();
query.abort();
query.destroy();
query.promise();
```

## Query Client

```js
import { queryClient } from 'vanilla-signal-query';

await queryClient.prefetchQuery({
  queryKey: ['product', 1],
  staleTime: 60_000,
  queryFn: () => fetchProduct(1),
});

queryClient.invalidateQueries(['products']);
queryClient.setQueryData(['product', 1], (product) => ({
  ...product,
  liked: true,
}));
```

## Documentation

- [API and usage](./docs/query.md)
- [Design notes](./docs/design.md)
