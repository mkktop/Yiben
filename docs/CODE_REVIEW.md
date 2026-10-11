# 雨读 Yudu — 代码全面审查报告

> **状态（2026-09-25 标注）：本报告基于 v0.1.1（2026-09-11），所列 P0/P1/P2 问题已在随后两轮修复
> （2026-09-14 与 2026-09-19 的审查修复提交，见 git log「审查修复」）中全部处理完毕。**
> 保留本文仅作历史记录与方法参考——**不要按本报告去修代码**，其中指出的问题在当前代码里已不存在，
> 引用的行号也早已漂移。新的审查请以当前代码为基线另起报告。

- 审查日期：2026-09-11
- 审查范围：`src/main`（主进程）、`src/preload`、`src/renderer`（React）、`src/shared`、打包与依赖配置
- 代码规模：约 11,000 行 TS/TSX，75 个源文件
- 基线状态：`tsc --noEmit`（node + web）**全部通过**；`vitest run` **7 文件 / 65 用例全绿**

---

## 总体评价

工程质量明显高于同类个人项目：自定义协议取图、云端 Range 直读、LRU 缓存 + 串行原子落盘、扫描互斥、渐进式 schema 迁移、FTS5 搜索、CSP、contextBridge 白名单配置项 —— 这些都是「踩过坑才知道要做」的设计，看得出是真实场景里打磨过的。

问题集中在三类：

1. **异步竞态与取消**（初始化竞态、fetch 无超时、预取消费不彻底、pdfjs 渲染任务不取消）
2. **资源生命周期**（压缩包句柄不关闭、孤儿缩略图文件、未清理的定时器）
3. **打包与运维配置**（无单实例锁、缺 asarUnpack、调试后门进了生产包）

没有发现可直接导致远程代码执行的高危漏洞，但有几个可靠性问题会在真实使用中稳定复现（下载卡死、进度丢失）。

---

## P0 — 严重（建议尽快修）

### 1. 阅读器初始化竞态会导致当前话进度永久不写入

`src/renderer/src/routes/reader/ReaderPage.tsx:80-104`

`init` 的 async 块在 `await` 之后没有校验「当前章节是否已被切走」。快速切话（末页自动进下一话、书签深链跳转）时，若 A 话的 `getPrefs` 比 B 话晚返回：

- `useReaderStore.getState().init(...)` 会用 **A 话的 page_count / startPage** 覆盖 B 话的状态；
- `readyFor.current = chapter.id` 被写成 **A**；

而进度写入的前置判断是 `readyFor.current !== chapter.id` 就早返回 —— 于是 **B 话从头到尾不保存进度**，翻页、关闭都不写库。

修复：进 async 前记 id，apply 前校验。

```ts
const myId = chapter.id
void (async () => {
  const [prefs, defaults] = await Promise.all([...])
  if (initFor.current !== myId) return          // ← 已被切走，丢弃这次结果
  useReaderStore.getState().init({ ...defaults, ...prefs }, chapter.page_count, startPage)
  readyFor.current = myId
  ...
})()
```

### 2. 云盘下载 `fetch` 没有超时，可能占死全部 3 个下载槽

`src/main/cloud189/cache.ts:210`

```ts
const resp = await fetch(url)   // 无 signal
```

`withDownloadSlot` 的全局上限是 3（`cache.ts:34`）。一旦 3 条连接同时静默挂起（直链服务器不响应、代理黑洞），**所有云盘读页与预取会永久死锁**，且 UI 上只表现为「一直转圈」。

修复：

```ts
const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) })
```

并把 `AbortError` 纳入已有的退避重试分支。同理建议给 `client.ts` 里 SDK/直连接口加超时观察：若 `cloud189-sdk` 底层 `got@11` 未设 timeout，同样存在悬挂风险。

### 3. remoteZip 的 inflate 没有解压上限（zip bomb）

`src/main/archives/remoteZip.ts:168`

`inflateRawSync(raw)` 前未校验 `entry.size`。天翼云盘上的文件是**不可信输入**，一个几十 MB 的高压缩比 zip 可在主进程里膨胀到 GB 级 → 主进程 OOM → 整个应用崩溃（不是渲染进程崩溃，无法靠刷新恢复）。

修复：解压前按 `entry.size` 设阈值（建议 100~200MB），并在 inflate 后校验实际长度与 `entry.size` 一致。

---

## P1 — 中等

| # | 位置 | 问题 | 影响 |
| --- | --- | --- | --- |
| 4 | `cloud189/client.ts:12-14` | 会话 token 以**明文**写入 `cloud189-token.json`（密码反而用 safeStorage 加密了） | 本机其他程序可读走 7 天有效期的会话。建议改用自定义 TokenStore 走 `safeStorage`，或至少限权 0600 |
| 5 | `main/index.ts:144` | `app.whenReady().then(...)` 无 `.catch` | `openDb()` 抛错（磁盘满/DB 损坏）时静默白屏，无任何提示 |
| 6 | `main/index.ts`（全局） | **缺 `app.requestSingleInstanceLock()`** | 可开多个实例，并发扫描 + 并发写 SQLite，扫描互斥标志只在本进程内有效 |
| 7 | `main/ipc.ts:154` + `db/index.ts:259-265` | `updateSeriesMeta` 把 patch 的 key 直接插值进 SQL（`${key} = @${key}`） | 渲染层可控字段名进 SQL 字符串。当前受 contextIsolation 保护，但属纵深防御缺口 —— 加个白名单即可：`const ALLOWED = new Set(['title','author','status','tags','description'])` |
| 8 | `main/index.ts:133` | `shell.openExternal(details.url)` 未校验 scheme | 任何 `window.open()` 都会交给系统打开（`file://`、自定义协议等）。建议只允许 `http/https/mailto` |
| 9 | `cloud189/cache.ts:226-238` | 下载完成后只 `rename`，不校验 `loaded === total` | 静默截断的响应会被当成完整缓存；当 `expectedSize` 为 0 时（`cachedSizeIfComplete` 回退比索引记录大小）**毒化缓存会永久存在**。建议 rename 前 `if (total > 0 && loaded !== total) throw` |
| 10 | `cloud189/scanner.ts:144`、`ensure.ts` | 缓存文件名用 `cloudId`/`chapterId`，**不含 familyId 与账号维度** | 切换家庭云/账号时可能命中彼此缓存，返回错误内容 |
| 11 | `scanner/index.ts:254` + `db/index.ts:361` | `deleteChaptersNotIn` 删章节但不返回被删 id，页缩略图 `thumbs/pages/{chapterId}/` 残留 | 长期累积孤儿文件。建议改成 `DELETE ... RETURNING id` 后调 `removePageThumbs` |
| 12 | `thumbnail.ts:28` | `generateCover` 用 `getDriver`（LRU 常驻）却从不 `close` | 压缩包句柄与 RAR 整包 Buffer 滞留在 LRU 里，封面批量生成时 fd 与内存峰值高。应改用 `withDriver`（开即关） |
| 13 | `routes/reader/PdfViewer.tsx:122-147` | `page.render()` 的 task 未保存、卸载时未 `task.cancel()` | 切话/卸载后 pdfjs 仍在后台渲染，可能抛未捕获异常、浪费 CPU |
| 14 | `ReaderPage.tsx:36`、`ReaderChrome.tsx:90` | `useReaderStore()` 不传选择器，订阅整个 store | 每次 `setPage`（条漫滚动时极频繁）触发整个阅读器子树 reconcile。改成细粒度选择器收益明显 |
| 15 | `db/index.ts:621-640` | `continueReading` 用 `GROUP BY ... HAVING p2.updated_at = MAX(p2.updated_at)` | 依赖 SQLite「裸列取 min/max 行」的扩展行为，语义脆弱，可能返回非最新一话甚至整组被滤除。建议改成窗口函数或 `JOIN (SELECT series_id, MAX(updated_at) ...)` |
| 16 | `ipc.ts:245-251` | `reader:file` 把整个 PDF 作为 Buffer 经 IPC 回传 | 大 PDF 一次性进渲染进程内存并阻塞结构化克隆。协议层已注册 `yudu://file/{id}`，直接改走协议流式加载即可 |
| 17 | `cloud189/prefetch.ts:82,123` | `cancelPrefetch` 只置标志位，进行中的 `ensureCached` 无 AbortSignal | 取消大压缩包预取后仍占带宽和下载槽数十秒~数分钟 |
| 18 | `main/index.ts:17-60` | `YUDU_EVAL` / `YUDU_SCREENSHOT` / `YUDU_ROUTE` 等调试钩子**编译进生产包** | 任何人设置环境变量即可在渲染进程执行任意 JS。建议用 `is.dev` 门控，或打包时用 `import.meta.env` / define 剔除 |

---

## P2 — 轻微 / 优化方向

**渲染层**
- `components/library/CoverImage.tsx:33-39` 重试 `setTimeout` 无 cleanup，虚拟滚动滑出后仍 setState。
- `components/library/CoverGrid.tsx` `estimateSize: 262` 与实际行高（封面 3:4 + 两行标题 ≈ 290）偏差，滚动条长度不对；路由返回书架时 scrollTop 不恢复。
- `reader/useCurrentPageObserver.ts:46-47` 每次 mutation 都 `querySelectorAll` 全量重扫，PDF 多页时近似 O(n²)。改为只 observe `addedNodes`。
- `ReaderPage.tsx:305/361/432/230` 多处 `void window.yudu.xxx(...)` 未 `.catch`，IPC 失败会产生 unhandled rejection。
- `routes/CloudPage.tsx:123` `useAsync(..., [])` 未订阅 `version`，页内新增挂载后列表不刷新。

**主进程**
- `pageThumb.ts:42-47` `buildPageThumb` 失败时 `.part.webp` 残留（prune 也会把它算进容量）。
- `archives/remoteZip.ts:87` `cdSize === 0xffffffff` 但无 zip64 locator 时会发起巨型 Range 请求；`:166` 零长条目起止颠倒。
- `db/index.ts:590` `saveProgress` 每次翻页都 `db.prepare(...)` 重新编译语句；`scanner/index.ts:243-253` 逐章 upsert 未包事务。大库扫描与连翻时会阻塞主进程事件循环 —— 建议缓存 prepared statement、把章节 upsert 包进 `db.transaction`。
- `archives/index.ts:45` LRU `CACHE_MAX = 6` 对 RAR 不友好（`rar.ts:19` 整包读内存），6 个大 CBR 常驻即数 GB。建议按驱动类型/文件大小设不同上限。
- `ipc.ts:106-116` `isScanning()` 检查与 `removeLibrary` 之间有 `await clearLibraryCache`，存在 TOCTOU 窗口（影响很小，但可把检查移到 lock 内部）。

**依赖与打包**
- `cloud189-sdk@1.0.9` → 依赖 `got@11.8.2`（该大版本已停止维护，官方现为 14.x）与冷门包 `@netdrive-sdk/log@1.0.0`。建议关注上游更新，或考虑自行实现所需少量接口以收窄供应链。
- `electron-builder.yml` / `package.json` 均**未配置 `asarUnpack`**，而 `7zip-bin`（需执行外部二进制）、`sharp`、`better-sqlite3`（`.node` + DLL）都在 asar 内可能无法加载/执行；同时 `npmRebuild: false` 意味着原生模块不会针对 Electron ABI 重编。既然已产出 dist 说明当前版本侥幸可用，但升级 Electron 时一定会炸 —— 建议显式声明 `asarUnpack` 并打开 rebuild。
- `package.json` 的 `dist` 脚本是 `electron-builder --win nsis`，但 `electron-builder.yml` 里配了 `nsis + portable`，README 又写「nsis + portable」—— 三者不一致。
- 测试 65 个用例覆盖了解析、remoteZip、reader store、backoff 等核心逻辑，但**没有 DB / IPC / 端到端覆盖**。上面 P0 的 1、2 两条恰好都在无测试区域。建议补一组 DB 层测试和一次 selftest 冒烟（项目已有 `YUDU_SELFTEST` 基础设施，很适合接进 CI）。

---

## 做对了的地方（不要动）

- **`yudu://` 自定义协议取图**（`protocol.ts`）而非 IPC 传字节，配合同页并发去重（`pageInflight`）——这是本项目性能的关键，别为了「统一走 IPC」改回去。
- **缓存索引的串行原子落盘**（`cache.ts:64-83`）：注释里明确写了「并发请求互相覆盖 / 非原子写入导致索引重置」，已用 `flushChain` + tmp+rename 解决。这块**不需要改**，我一度以为有竞态，读完确认已处理。
- **删除书库前先取产物清单**（`ipc.ts:109-115`）：先 `libraryArtifacts(id)` 再删行，避免级联后查不到 —— 这个顺序很容易写反。
- **消失的系列只标记 `missing` 不硬删**（`db/index.ts:268-280`）：移动硬盘未挂载场景的正确处理。
- **CSP**（`renderer/index.html`）：`default-src 'self'`、`img-src 'self' yudu: data:`，收敛得很好。
- **响应式/配置白名单**（`ipc.ts:67` `CONFIG_KEYS`）：settings 表里有加密凭据，明确拒绝渲染层读写，这个意识很到位。
- `windowBounds` 恢复前的多显示器有效性校验（`index.ts:71-85`）：细节到位。

---

## 建议修复顺序

1. **P0 三条**（初始化竞态、fetch 超时、zip bomb）——改动都很小，收益最大。
2. **P1 里的 4/6/18**（token 加密、单实例锁、调试后门下线与 whenReady catch）——属安全与健壮性底线。
3. **P1 里的 12/14/15**（句柄泄漏、store 订阅粒度、HAVING 查询）——用户能感知的性能与正确性。
4. **补测试**：把 P0-1、P0-2 的固定作为回归用例锁住。
5. **打包配置**（asarUnpack / rebuild / dist 脚本一致性）——在下次升级 Electron 前处理掉。
