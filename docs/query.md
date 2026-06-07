# Vanilla Query 文档

`vanilla-query` 是面向原生 JavaScript 业务请求场景的异步状态管理库。它提供响应式请求状态、LRU 缓存、请求去重、重试、超时、取消、预取和缓存失效能力。

## 设计目标

- 独立数据层：只处理请求、缓存、状态和失效，不绑定 DOM 渲染。
- 函数式 API：使用 `createQuery` 返回可调用的数据 accessor，读取数据直接调用 `query()`。
- 业务请求友好：内置 `status`、`isLoading`、`isFetching`、`isStale`、`failureCount`、`refetch`、`retry`、`mutate` 等页面常用能力。
- 跨实例缓存：相同 `queryKey` 共享 LRU 缓存和 pending 请求。
- 可控一致性：支持 `staleTime`、`cacheTime`、`invalidateQueries`、`removeQueries` 和 `prefetchQuery`。
- 请求安全：支持 AbortController、timeout、请求去重、重试和竞态保护。

## createQuery 形态

`createQuery` 返回一个可调用函数。函数本身用于读取当前数据，状态和控制方法挂在函数对象上：

```js
const user = createQuery({
  queryKey: ['user', userId],
  queryFn: async ({ queryKey, signal }) => {
    const response = await fetch(`/api/users/${queryKey[1]}`, { signal });
    return response.json();
  },
});

user(); // 当前 data
user.state.status;
user.refetch();
```

这种形态把“读取数据”和“控制请求”放在同一个 query 对象上，适合列表、详情、搜索、仪表盘卡片等业务请求。

## 安装与引入

```js
import { createQuery, queryClient, createQueryClient } from 'vanilla-query';
```

浏览器原生模块中可引入打包后的 `dist/query.mjs`。

## 基本用法

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

`createQuery` 创建后默认自动执行。返回值是一个函数，调用它读取当前 `data`。

## 状态字段

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

常用区别：

- `isLoading`：当前没有可展示数据，并且正在请求。
- `isFetching`：正在请求，可能是首次加载，也可能是后台刷新。
- `isStale`：当前数据可展示，但已经过期或正在用旧数据等待新结果。
- `status`：描述数据结果状态。
- `fetchStatus`：描述请求过程状态。

## queryKey

`queryKey` 用于缓存、去重和失效。推荐使用数组：

```js
createQuery({
  queryKey: ['products', { page: 1, keyword: 'phone' }],
  queryFn,
});
```

对象 key 会稳定排序，所以以下两个 key 等价：

```js
['products', { page: 1, keyword: 'phone' }];
['products', { keyword: 'phone', page: 1 }];
```

`queryKey` 可以是响应式 accessor：

```js
const [page, setPage] = createSignal(1);

const list = createQuery({
  queryKey: () => ['products', page()],
  keepPreviousData: true,
  queryFn: ({ queryKey }) => fetchPage(queryKey[1]),
});
```

当 `page()` 变化时，query 会自动切换 key 并请求新数据。

## queryFn

```js
queryFn({
  queryKey,
  attempt,
  signal,
  meta,
});
```

- `queryKey`：当前解析后的 key。
- `attempt`：第几次尝试，从 1 开始。
- `signal`：用于取消 fetch。
- `meta`：`refetch({ meta })` 或 `prefetchQuery({ meta })` 传入的附加信息。

## 常用方法

```js
query.refetch(); // 强制后台刷新，默认保留旧数据
query.reload(); // 强制重新加载，默认不保留旧数据
query.retry(); // 强制再请求一次
query.mutate(updater); // 本地更新并写入缓存
query.invalidate(); // 标记当前 query cache stale
query.remove(); // 删除当前缓存并重置状态
query.abort(); // 中断当前请求并忽略旧结果
query.destroy(); // 销毁响应式 effect 和请求
query.promise(); // 当前 pending promise
query.key(); // 当前 hash key
query.queryKey(); // 当前原始 queryKey
query.subscribe((state) => {});
```

## 缓存策略

默认启用缓存：

```js
createQuery({
  queryKey: ['user', 1],
  staleTime: 1000 * 30,
  cacheTime: 1000 * 60 * 5,
  cacheMax: 100,
  queryFn,
});
```

- `staleTime`：数据保持 fresh 的时间。默认 `0`，表示成功后立即可被后台刷新。
- `cacheTime`：缓存记录保留时间。默认 5 分钟。
- `cacheMax`：LRU 最大缓存条数。默认 100。
- `cache: false`：关闭缓存。

示例：

```js
const user = createQuery({
  queryKey: ['user', id],
  staleTime: 60_000,
  cacheTime: 10 * 60_000,
  queryFn,
});
```

一分钟内再次创建相同 key 的 query 会直接使用缓存；十分钟后缓存被 LRU 过期。

## Query Client

默认导出 `queryClient`，也可以创建独立 client：

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

### 预取

```js
await queryClient.prefetchQuery({
  queryKey: ['product', 1],
  staleTime: 60_000,
  queryFn: () => fetchProduct(1),
});
```

### 读取与写入缓存

```js
queryClient.getQueryData(['product', 1]);

queryClient.setQueryData(['product', 1], (previous) => ({
  ...previous,
  liked: true,
}));
```

### 失效和删除

```js
queryClient.invalidateQueries(['products']);
queryClient.removeQueries(['products', 1]);
queryClient.clear();
```

数组 filter 支持前缀匹配，`["products"]` 可以命中 `["products", 1]`、`["products", 2]`。

### 监听 client 事件

```js
const unsubscribe = queryClient.subscribe((event) => {
  console.log(event.type, event.key);
});
```

事件类型包括 `set`、`fetch`、`success`、`error`、`invalidate`、`remove`、`clear`。

## 重试

```js
createQuery({
  queryKey: ['report'],
  retry: 2,
  retryDelay: (attempt) => attempt * 500,
  queryFn,
});
```

默认不会重试 4xx 错误和 `AbortError`。可以自定义：

```js
createQuery({
  retry: (attempt, error) => attempt < 3 && error.status >= 500,
  shouldRetry: (error) => error.name !== 'AbortError',
  queryFn,
});
```

## Timeout 和 Abort

```js
const query = createQuery({
  queryKey: ['slow'],
  timeout: 8000,
  queryFn: ({ signal }) => fetch('/api/slow', { signal }).then((r) => r.json()),
});

query.abort();
```

请求超时会抛出 `TimeoutError`，并尝试 abort 当前请求。

## 业务响应归一化

默认支持 `{ success, data, message, code }` 风格：

```js
{ success: true, data: [...] }
{ success: false, message: "No access", code: "NO_ACCESS" }
```

`success: false` 会转换成 `BusinessError`。

如果后端结构不同，可以传 `normalize`：

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

关闭归一化：

```js
createQuery({
  normalize: false,
  queryFn,
});
```

## select

`select` 用于从响应数据里派生最终写入 state/cache 的数据：

```js
createQuery({
  queryKey: ['users'],
  queryFn: fetchUsers,
  select: (users) => users.filter((user) => user.active),
});
```

## enabled

`enabled` 可以是布尔值或 accessor：

```js
const [id, setId] = createSignal(null);

const user = createQuery({
  enabled: () => id() !== null,
  queryKey: () => ['user', id()],
  queryFn,
});
```

未启用时不会自动请求，`state.isPaused` 为 `true`。手动 `refetch()` 会强制请求。

## Suspense 与 throwErrors

```js
createQuery({
  suspense: true,
  throwErrors: true,
  queryFn,
});
```

- `suspense: true`：读取 `query()` 时，如果首次请求还在 pending，会抛出当前 Promise。
- `throwErrors: true`：读取 `query()` 时，如果有错误，会抛出当前 error。

普通业务页面更推荐直接读 `query.state`。

## 适用场景

`createQuery` 适合管理需要和服务端同步的业务数据：

- 列表、详情、搜索、分页、筛选。
- 多个 UI 区域读取同一个接口数据。
- 需要缓存、预取、去重、失效或乐观更新。
- 需要统一处理 loading、refreshing、error、retry 状态。

`vanilla-query` 不负责 DOM 渲染。UI 层只消费 `query()` 和 `query.state`，渲染方式由应用自己决定。
