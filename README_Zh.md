# Vanilla Query

`vanilla-query` 是一个面向原生 JavaScript 的服务端状态和异步 query 运行时。它提供响应式请求状态、LRU 缓存、stale 刷新、请求去重、重试、超时、取消、预取和缓存失效。

它设计为配合 [`vanilla-signal`](https://github.com/WangShai123/vanilla-signal) 使用：

```js
import { createEffect } from 'vanilla-signal';
import { createQuery } from 'vanilla-query';

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

## 安装

npm:

```bash
npm install vanilla-signal-query
```

script:

```html
<!-- umd 全局变量：query -->
<script src="https://unpkg.com/vanilla-signal-query/dist/index.umd.js"></script>
<script>
  const { createQuery } = query;
</script>

<!-- esm 模块导入 -->
<script type="module">
  import { createQuery } from 'https://unpkg.com/vanilla-signal-query/dist/index.mjs';
</script>
```

## 核心 API

- `createQuery(options)`：创建响应式 query accessor。
- `queryClient`：默认共享 query client。
- `createQueryClient(options)`：创建隔离的缓存和请求 client。
- `stableHash(value)` 和 `hashQueryKey(queryKey)`：稳定 key 工具。

## Query 配置

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

## Query 方法

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
import { queryClient } from 'vanilla-query';

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

## 文档

- [API 与使用文档](./docs/query_zh.md)
- [设计说明](./docs/design_zh.md)
