# 第 2 集：createQuery 基础请求

## 本集目标

- 创建第一个 query。
- 理解 `query()` 和 `query.state`。
- 用 loading、error、success 三种状态组织 UI。

## 1. 最小示例

```js
import { createQuery } from 'vanilla-signal-query';

const profile = createQuery({
  queryKey: ['profile'],
  queryFn: async ({ signal }) => {
    const response = await fetch('/api/profile', { signal });
    return response.json();
  },
});
```

口播：

`queryKey` 是这次请求的身份。

`queryFn` 是真正执行请求的函数。

`signal` 来自 AbortController，用 fetch 时建议传进去。

## 2. 读取数据

```js
profile();
```

`profile` 本身是一个函数，调用它读取当前数据。

首次请求还没完成时，默认是 `undefined`。

## 3. 读取状态

```js
profile.state.status;
profile.state.isLoading;
profile.state.isFetching;
profile.state.isError;
profile.state.error;
profile.state.isSuccess;
```

口播：

`status` 描述结果，`fetchStatus` 描述过程。

第一次进入页面，既没有数据又在请求，这时是 loading。

如果已经有旧数据，同时后台刷新，这时不是 loading，而是 fetching。

## 4. UI 写法

```js
createEffect(() => {
  if (profile.state.isLoading) {
    app.textContent = 'Loading...';
    return;
  }

  if (profile.state.isError) {
    app.textContent = profile.state.error.message;
    return;
  }

  app.textContent = profile()?.name || '';
});
```

口播：

不要把请求和 DOM 渲染塞进 query 里。

query 只提供数据和状态，UI 层决定怎么展示。

## 5. 手动刷新

```js
button.addEventListener('click', () => {
  profile.refetch();
});
```

`refetch` 会强制重新请求，默认保留旧数据。

如果你希望像首次加载一样清空旧数据，用 `reload`：

```js
profile.reload();
```

## 6. 初始数据

```js
const list = createQuery({
  queryKey: ['products'],
  initialData: [],
  queryFn: fetchProducts,
});
```

口播：

列表类页面经常给 `initialData: []`，这样渲染时不用到处判断 `undefined`。

## 结尾

这一集我们会用 `createQuery` 发起请求，并根据状态渲染 UI。

下一集进入 query 的核心能力：`queryKey`、缓存、预取和 stale 时间。
