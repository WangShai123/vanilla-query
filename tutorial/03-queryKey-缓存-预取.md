# 第 3 集：queryKey、缓存与预取

## 本集目标

- 理解 `queryKey`。
- 理解 `staleTime` 和 `cacheTime`。
- 使用 `queryClient.prefetchQuery`。
- 使用 `invalidateQueries` 让缓存过期。

## 1. queryKey 是请求身份

```js
createQuery({
  queryKey: ['product', 1],
  queryFn: fetchProduct,
});
```

口播：

queryKey 不只是一个名字，它决定三件事：

- 缓存存在哪里
- pending 请求能不能去重
- 后续怎么失效

推荐用数组。

```js
['products', { page: 1, keyword: 'phone' }];
```

对象里的字段顺序不会影响最终 key。

## 2. fresh 和 stale

```js
const product = createQuery({
  queryKey: ['product', 1],
  staleTime: 60_000,
  queryFn: fetchProduct,
});
```

口播：

`staleTime` 表示数据多久以内算新鲜。

一分钟内再次创建相同 key 的 query，会直接用缓存，不会重新请求。

超过一分钟，旧数据还能先显示，但会触发后台刷新。

## 3. cacheTime

```js
createQuery({
  queryKey: ['product', 1],
  staleTime: 60_000,
  cacheTime: 10 * 60_000,
  queryFn: fetchProduct,
});
```

口播：

`cacheTime` 不是新鲜时间，而是缓存保留时间。

数据 stale 了不代表马上删除。

stale 后还能用于快速展示旧内容，然后后台刷新。

## 4. 预取

```js
import { queryClient } from 'vanilla-query';

link.addEventListener('mouseenter', () => {
  queryClient.prefetchQuery({
    queryKey: ['product', productId],
    staleTime: 60_000,
    queryFn: () => fetchProduct(productId),
  });
});
```

口播：

预取适合鼠标 hover、下一页、详情页提前加载。

用户真的进入详情页时，如果缓存还是 fresh，就能直接显示。

## 5. 失效

```js
await saveProduct(product);

queryClient.invalidateQueries(['products']);
queryClient.invalidateQueries(['product', product.id]);
```

口播：

保存成功后，不一定要手动重新请求所有列表。

先把相关 query 标记为 stale。

下次页面读取或者调用 refetch 时，它会拿到新数据。

数组 filter 支持前缀匹配。

```js
invalidateQueries(['products']);
```

可以命中：

```js
['products', 1];
['products', 2];
['products', { keyword: 'phone' }];
```

## 结尾

这一集讲了 queryKey 和缓存生命周期。

下一集我们用响应式 queryKey 做搜索和分页，重点看保留旧数据和竞态保护。
