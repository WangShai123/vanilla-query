# Vanilla Query 教程脚本

这组文案用于制作 `vanilla-query` 教程视频。前 6 集讲核心 API，第 7 到第 9 集基于 `tests/test.html` 做完整实战。建议每集 8 到 18 分钟。

| 集数 | 文件                                      | 主题                                               |
| ---- | ----------------------------------------- | -------------------------------------------------- |
| 01   | `01-为什么需要-vanilla-query.md`          | 定位、服务端状态、核心能力                         |
| 02   | `02-createQuery-基础请求.md`              | 基本 API、状态字段、loading/error/success          |
| 03   | `03-queryKey-缓存-预取.md`                | queryKey、LRU 缓存、staleTime、cacheTime、prefetch |
| 04   | `04-搜索分页与保留旧数据.md`              | 响应式 key、keepPreviousData、竞态保护、abort      |
| 05   | `05-重试超时与业务错误.md`                | retry、timeout、normalize、BusinessError           |
| 06   | `06-mutate-失效与项目实践.md`             | mutate、invalidate、remove、client 事件和最佳实践  |
| 07   | `07-实战演示台-商品搜索分页.md`           | 搭建测试页、商品搜索分页、状态驱动 UI、预取        |
| 08   | `08-实战演示台-详情缓存与乐观更新.md`     | 详情缓存、select、getQueryData、Todo 乐观更新      |
| 09   | `09-实战演示台-错误高级读取与自动检查.md` | 重试、业务错误、超时、取消、订阅、自动检查         |

录制建议：

- 每集先用 30 秒讲业务问题，再写代码。
- 所有示例都围绕列表、详情、搜索、保存后的刷新这些常见业务。
- 不强调框架对比，重点讲“服务端状态”和“页面本地状态”的区别。
- `createQuery` 不负责 DOM 渲染，UI 层只消费 `query()` 和 `query.state`。
- 实战课以 `tests/test.html` 为统一案例，录制时可以边点击页面边讲代码。
