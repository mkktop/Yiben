# 云盘扫描进度事件契约

> 2026-10-22（v0.3.3）：云端扫描此前只在系列间报进度且根遍历完全静默，大库开头像卡死；
> 现按本契约插桩，改扫描器时勿破坏。

- **done 只由 `rescan.ts` 的 finally 统一广播**；`cloud/scanner.ts` 管线自身只发 `phase:'reading'`（本地 `scanner/index.ts` 例外，它自带 done，rescan 会过滤）。
- **首条事件必须先于任何网络调用**（管线入口即发 `{current:0,total:0,title:'正在读取云端目录'}`）——ScanIndicator 收到第一条非 done 事件才出现，不发就整段静默。
- **current/total 口径恒为系列级**；系列内部细化只改 title（「系列名（i/n）」），避免同一浮标两套计数打架。唯一例外：单系列整库模式（库根即一部作品）用章节序号当计数。
- 天翼列举走 300ms `MinIntervalChain` 闸：大库根遍历耗时 ≈ 目录数 × 0.3s × 下钻层数，评估「扫描卡住」反馈时按此估算。
- 单元测试 `src/main/cloud/scanner.test.ts` 用 fake 目录树断言事件序列（首条先于联网、分类 i/N、章节级标题），改管线先跑它。
- **渲染层书架刷新走节流**：`lib/scanRefresh.ts` 把进度事件接到 dataStore version——首轮立即、之后 5s 一次、done 无条件；扫描中途刷出的是半对账快照（retire/FTS 都在收尾），这是接受的取舍。**云端扫描收尾必须 rebuildFts**（搜索走 series_fts MATCH，漏了云盘系列就搜不到，v0.3.4 修过一次）。
