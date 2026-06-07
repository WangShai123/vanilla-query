# 第 1 集：为什么需要 vanilla-query

## 本集目标

这一集讲清楚三个问题：

- `vanilla-query` 解决什么问题。
- 什么是服务端状态。
- `createQuery` 的核心心智模型是什么。

## 开场口播

在业务页面里，请求数据通常不是简单的“发起请求，然后显示结果”。

真实场景会遇到这些问题：

- 同一个接口数据会被多个区域使用。
- 用户返回列表页时，希望先看到缓存数据。
- 搜索和分页切换时，希望保留旧数据，避免页面闪烁。
- 保存成功后，需要让相关列表和详情过期。
- 网络失败时，需要重试。
- 重复进入页面时，不希望每次都重新请求。

`vanilla-query` 就是用来管理这些服务端状态的。

## 1. 什么是服务端状态

口播：

页面里有两类常见状态。

第一类是本地状态，比如弹窗开关、输入框内容、当前 tab、鼠标 hover。

第二类是服务端状态，比如商品列表、用户详情、订单状态、搜索结果。

服务端状态有几个特点：

- 数据来源在服务端。
- 本地缓存可能过期。
- 多个地方可能读取同一份数据。
- 写操作完成后，需要刷新或失效相关数据。
- 请求过程会出现 loading、refreshing、error、retry。

`vanilla-query` 关注的是第二类状态。

## 2. createQuery 最小示例

```js
const user = createQuery({
  queryKey: ['user', 1],
  queryFn: async ({ queryKey, signal }) => {
    const response = await fetch(`/api/users/${queryKey[1]}`, { signal });
    return response.json();
  },
});
```

读取数据：

```js
user();
```

读取状态：

```js
user.state.isLoading;
user.state.isFetching;
user.state.isError;
user.state.isStale;
```

手动刷新：

```js
user.refetch();
```

## 3. queryKey 是请求身份

口播：

`queryKey` 是 query 的身份。

它决定三件事：

- 缓存存在哪里。
- pending 请求能不能去重。
- 后续怎么让数据失效。

推荐使用数组：

```js
['products', { page: 1, keyword: 'phone' }];
```

保存成功后可以让整个产品列表过期：

```js
queryClient.invalidateQueries(['products']);
```

## 4. queryFn 是请求函数

`queryFn` 接收一个上下文对象：

```js
queryFn({
  queryKey,
  signal,
  attempt,
  meta,
});
```

口播：

`queryKey` 用来拿当前参数。

`signal` 用来取消 fetch。

`attempt` 表示当前是第几次尝试。

`meta` 可以在手动刷新或预取时传一些额外信息。

## 5. query state 的心智模型

口播：

`status` 描述结果。

`fetchStatus` 描述过程。

所以页面上可以表达几种状态：

```js
query.state.isLoading; // 没有数据，正在加载
query.state.isFetching; // 正在请求，可能已有旧数据
query.state.isStale; // 当前数据已经过期或正在刷新
query.state.isError; // 最近一次请求失败
```

这比只用一个 `loading` 更适合真实业务页面。

## 6. createQuery 不负责渲染

口播：

`vanilla-query` 只负责数据层。

它不会决定 DOM 怎么写，也不会内置 loading 组件或 error 组件。

UI 层只需要消费：

```js
query();
query.state;
```

渲染方式由应用自己决定。

## 结尾

这一集建立了服务端状态和 `createQuery` 的基本心智模型。

下一集我们开始写第一个完整请求，看 loading、error、success 三种状态如何落到页面里。
