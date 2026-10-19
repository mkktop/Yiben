# 审查误报勘误（2026-09-11）

> 两轮审查中曾被判为缺陷、实测确认**不是缺陷**的点，避免后人重复「修复」。

- `cloud189/cache.ts` 的 `withDownloadSlot` 计数**没有错乱**：等待者被唤醒前 `finally` 已 `activeDownloads++`，限流 3 有效。不要按「唤醒时再自增」去改。
- `DELETE ... WHERE path NOT IN ()` 在 better-sqlite3/SQLite 中**可执行**，空列表不会语法错误；`deleteChaptersNotIn` 无需为此加特判。
- 缓存索引的 `flushChain` 串行 + tmp/rename 原子落盘**已正确**处理并发覆盖，不要改成并行写。
- `protocol.ts` 的 `pageInflight` 同页去重是性能关键设计，别为了「统一走 IPC」删掉。

更完整的审查结论见 [`../CODE_REVIEW.md`](../CODE_REVIEW.md)；该报告中的问题均已修复，仅作历史记录。
