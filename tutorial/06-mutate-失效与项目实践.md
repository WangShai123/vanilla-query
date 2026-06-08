# 第 6 集：mutate、失效与项目实践

## 本集目标

- 使用 `mutate` 做乐观更新。
- 保存成功后失效相关 query。
- 使用独立 query client。
- 总结项目组织方式。

## 1. mutate 本地更新

```js
const todos = createQuery({
  queryKey: ['todos'],
  initialData: [],
  queryFn: fetchTodos,
});

todos.mutate((list) => {
  return list.map((todo) =>
    todo.id === id ? { ...todo, done: !todo.done } : todo
  );
});
```

口播：

`mutate` 会立即更新当前 state，并写入缓存。

适合点赞、开关、todo 勾选这类操作。

## 2. 乐观更新加回滚

```js
async function toggleTodo(id) {
  const previous = todos();

  todos.mutate((list) =>
    list.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo))
  );

  try {
    await fetch(`/api/todos/${id}/toggle`, { method: 'POST' });
  } catch (error) {
    todos.mutate(previous);
  }
}
```

口播：

先保存旧数据。

接口失败时，把旧数据写回去。

这是最简单的乐观更新模式。

## 3. 保存成功后失效

```js
import { queryClient } from 'vanilla-signal-query';

async function createTodo(input) {
  await fetch('/api/todos', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  queryClient.invalidateQueries(['todos']);
}
```

口播：

新增 todo 后，不需要知道当前页面有哪些分页、哪些筛选条件。

把 `["todos"]` 前缀全部标记为 stale。

页面下一次刷新或重新进入时，会自动拿新数据。

## 4. 删除缓存

```js
queryClient.removeQueries(['todo', id]);
```

口播：

如果数据已经不存在，比如删除详情页对象，可以直接移除对应缓存。

## 5. 独立 client

```js
const adminQueryClient = createQueryClient({
  cacheMax: 500,
  cacheTime: 10 * 60_000,
});

const users = createQuery({
  client: adminQueryClient,
  queryKey: ['admin', 'users'],
  queryFn: fetchUsers,
});
```

口播：

大多数项目用默认 `queryClient` 就够了。

如果你要隔离后台、前台、测试环境，或者有不同缓存策略，可以创建独立 client。

## 6. 项目组织建议

推荐把请求函数和 query key 组织到一起：

```js
export const productKeys = {
  all: ['products'],
  list: (params) => ['products', params],
  detail: (id) => ['product', id],
};

export function createProductsQuery(params) {
  return createQuery({
    queryKey: () => productKeys.list(params()),
    queryFn: ({ queryKey, signal }) => fetchProducts(queryKey[1], signal),
  });
}
```

口播：

不要在页面里到处手写字符串 key。

把 key 集中管理，后面做失效和预取会更稳。

## 7. 收尾总结

`vanilla-query` 的核心不是替你渲染页面，而是把服务端状态管清楚。

记住几个关键词：

- `queryKey` 决定身份。
- `staleTime` 决定新鲜度。
- `cacheTime` 决定保留时间。
- `refetch` 刷新。
- `mutate` 本地更新。
- `invalidateQueries` 让相关数据过期。

到这里，`vanilla-query` 的核心业务请求流程就完整了。
