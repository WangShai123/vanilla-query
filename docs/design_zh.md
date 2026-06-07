# Vanilla Query 设计说明

## 设计原则

`vanilla-query` 专注于服务端状态管理。它只处理请求、缓存、状态、失效和请求生命周期，不绑定 DOM 渲染，也不规定 UI 组织方式。

核心原则：

- 数据层独立：query 不直接操作 DOM。
- 状态可观察：每个 query 暴露响应式 `state`。
- 缓存可共享：相同 `queryKey` 可以复用缓存和 pending 请求。
- 刷新可控：通过 `staleTime`、`cacheTime`、`invalidateQueries` 控制数据新鲜度。
- 请求安全：通过 AbortController、timeout、retry 和 request id 处理取消、超时、重试与竞态。

## 架构

当前项目由两层组成：

- `createQuery(options)`：单个业务请求实例，负责解析 `queryKey`、维护状态、触发请求和暴露控制方法。
- `createQueryClient(options)`：缓存和请求协调器，负责 LRU 缓存、pending 去重、预取、失效、删除和事件通知。

默认提供一个共享 `queryClient`。如果需要隔离缓存，可以创建独立 client：

```js
const client = createQueryClient({
  cacheMax: 300,
  cacheTime: 10 * 60_000,
});
```

## createQuery 返回值

`createQuery` 返回一个函数：

```js
const query = createQuery({
  queryKey: ['products'],
  queryFn: fetchProducts,
});

query(); // 当前 data
query.state; // 当前状态
query.refetch(); // 控制方法
```

这种设计让读取数据保持简单，同时把状态和控制方法收敛在同一个 query 对象上。

## 状态模型

`status` 描述数据结果：

- `pending`：还没有成功数据。
- `success`：已有成功数据。
- `error`：最近一次请求失败。

`fetchStatus` 描述请求过程：

- `idle`：没有请求。
- `fetching`：正在请求。

因此可以表达“已有数据但正在刷新”的状态：

```js
query.state.status === 'success';
query.state.fetchStatus === 'fetching';
query.state.isStale === true;
```

常用布尔状态：

- `isPending`：还没有成功数据。
- `isLoading`：没有可展示数据，并且正在请求。
- `isFetching`：当前正在请求。
- `isStale`：当前数据已过期，或正在用旧数据等待新结果。
- `isSuccess`：当前有成功数据。
- `isError`：最近一次请求失败。
- `isPaused`：query 当前未启用。

## queryKey

`queryKey` 是请求身份，决定缓存、去重和失效。

推荐使用数组：

```js
['products', { page: 1, keyword: 'phone' }];
```

对象字段会稳定排序，因此下面两个 key 等价：

```js
['products', { page: 1, keyword: 'phone' }];
['products', { keyword: 'phone', page: 1 }];
```

数组 key 也支持前缀失效：

```js
queryClient.invalidateQueries(['products']);
```

可以命中：

```js
['products', 1];
['products', 2];
['products', { keyword: 'phone' }];
```

## 缓存模型

缓存记录结构：

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

缓存新鲜度：

```js
isStale = invalidated || Date.now() - updatedAt >= staleTime;
```

缓存保留由 LRU 管理：

- `cacheMax` 控制最大记录数。
- `cacheTime` 控制记录保留时间。
- `staleTime` 控制数据新鲜时间。

fresh cache 命中时，query 直接使用缓存。stale cache 命中时，query 可以先展示旧数据，再发起后台刷新。

## 请求模型

请求流程：

1. 解析 `queryKey` 和 `enabled`。
2. 如果 fresh cache 命中，直接写入 state。
3. 如果 stale cache 命中，先展示旧数据，再后台请求。
4. 如果没有可展示数据，进入 loading。
5. client 按 hash key 去重 pending 请求。
6. 请求成功后执行 `normalize` 和 `select`。
7. 写入 state 和 cache。
8. 请求失败后按 retry 策略重试。
9. 最终失败时写入 error state。
10. 过期请求返回时通过 request id 忽略结果。

## 错误模型

默认 normalize 支持 `{ success, data, message, code }` 风格响应。

```js
{ success: true, data: [] }
{ success: false, message: 'No access', code: 'NO_ACCESS' }
```

`success: false` 会转换为 `BusinessError`。

也可以自定义 `normalize`：

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

## 扩展点

常用扩展方式：

- `queryClient.subscribe(listener)`：监听缓存和请求事件。
- `onSuccess`、`onError`、`onSettled`：监听单个 query 生命周期。
- `normalize`：统一业务响应结构。
- `select`：从响应数据派生最终数据。
- 自定义 `retry`、`retryDelay`、`shouldRetry`：控制失败重试策略。
