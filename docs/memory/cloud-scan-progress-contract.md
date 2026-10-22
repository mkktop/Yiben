# 云盘扫描进度事件契约

> 2026-10-22（v0.3.3）：云端扫描此前只在系列间报进度且根遍历完全静默，大库开头像卡死；
> 现按本契约插桩，改扫描器时勿破坏。

- **done 只由 `rescan.ts` 的 finally 统一广播**；`cloud/scanner.ts` 管线自身只发 `phase:'reading'`（本地 `scanner/index.ts` 例外，它自带 done，rescan 会过滤）。
- **首条事件必须先于任何网络调用**（管线入口即发 `{current:0,total:0,title:'正在读取云端目录'}`）——ScanIndicator 收到第一条非 done 事件才出现，不发就整段静默。
- **current/total 口径恒为系列级**；系列内部细化只改 title（「系列名（i/n）」），避免同一浮标两套计数打架。唯一例外：单系列整库模式（库根即一部作品）用章节序号当计数。
- 天翼列举走 300ms `MinIntervalChain` 闸：大库根遍历耗时 ≈ 目录数 × 0.3s × 下钻层数，评估「扫描卡住」反馈时按此估算。
- 单元测试 `src/main/cloud/scanner.test.ts` 用 fake 目录树断言事件序列（首条先于联网、分类 i/N、章节级标题），改管线先跑它。
- **渲染层书架刷新走节流**：`lib/scanRefresh.ts` 把进度事件接到 dataStore version——首轮立即、之后 5s 一次、done 无条件；扫描中途刷出的是半对账快照（retire/FTS 都在收尾），这是接受的取舍。**云端扫描收尾必须 rebuildFts**（搜索走 series_fts MATCH，漏了云盘系列就搜不到，v0.3.4 修过一次）。
- **云盘扫描增量（v0.3.5）**：CloudEntry.mtime 三家来源——189 `lastOpTime`（'YYYY-MM-DD HH:mm:ss'，按 +08:00 解析，只求同字符串同数值）、115 `te`（unix 秒 ×1000）、WebDAV `getlastmodified`（PROPFIND 早已请求，v0.3.5 才解析）。两级跳过：①分类 wrapper 探测——根系列已入库（`seriesPathExists(scheme://根id)`）且子目录全部是已验证章节（`getChapterMetaIfUnchanged(f-{id}, 0, mtime) > 0`）→ 沿用 wrapper 分类不下钻；多系列布局子目录是系列而非章节，库里无 f-{子目录id}，不会误命中。②writeSeries 逐章页数列举——mtime 命中沿用库内 page_count、不调 replaceChapterPages、回写新 mtime。退化安全：mtime 缺省/对不上走全量。已知取舍：若网盘在改内容时不更新目录 mtime（三家正常都会更新），增量会漏检——重命名会使 id/path 变化自然重列。全命中时整库扫描 = 根列表 + 每个一级目录一次列表。
