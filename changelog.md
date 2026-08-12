# 变更日志

## 1.1.6

- feat: 复用更严格的 vanilla-signal 类型，新增 typed queryKey、select 数据和错误泛型，并导出缓存配置与错误上下文类型。
- feat: 批量写入 query state，并为在 vanilla-signal root 中创建的 query 注册 owner cleanup。
- fix: 合并持久化适配器 driverOptions 与隐式适配器配置，并将默认缓存 namespace 对齐为 signal。
- test: 新增 typed queryKey/select、owner cleanup、cookie 缓存适配器和 cache-error 事件覆盖。
- docs: 更新 API 与设计文档中的 vanilla-signal-query 命名、类型用法、持久化缓存 hydrate 和 cache-error 事件说明。
