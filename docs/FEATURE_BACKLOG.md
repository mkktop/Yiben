# 雨读 Yudu — 功能候选规格与交接话术

> 用途：本文档的每个功能都附带一段**可直接复制给另一个 AI 执行的完整提示词**。  
> 提示词已写成自包含形式（含项目背景、技术栈、代码约定、验收标准），粘贴到 Claude Code / Codex / Cursor 等工具即可开工，不需要对方再探索代码库。
>
> 生成日期：2026-09-11 ｜ 基于 v0.1.1 代码 ｜ 上下文块 2026-09-25 与根目录 `AGENTS.md` 对齐（两处同步维护，以 AGENTS.md 为准）

---

## 当前实现状态（2026-10-10）

下方规格保留了早期实现前的上下文，交接任务前先以当前源码和根目录 `AGENTS.md` 为准。
本轮审查与后续优先级见 [项目审查报告](PROJECT_AUDIT_2026-10-10.md)。

| 编号 | 当前状态 | 后续工作 |
| --- | --- | --- |
| A1 | 已实现阅读页数统计、热力图与活跃时长 | 失焦、后台或一分钟无操作暂停 |
| A2 | 已实现文件关联、单实例与冷启动领取 | 冷启动/热启动真实 Electron 回归已通过 |
| A3 | 已实现虚拟书架、自定义标签及筛选 | 无需重复开发 |
| A4 | 已实现库体检 | 目前依赖扫描结果，尚非逐包完整校验 |
| B1 | 已实现 WebDAV / NAS | HTTP/HTTPS + Basic + PROPFIND，支持 Range 回退与离线；真实 NAS 兼容性仍需用户环境验收 |
| B2 | 已实现条漫跨话连续拼接与旧页图片回收 | 跨话进度、全览跳页真实 Electron 回归已通过 |
| B3 / B4 | 已实现 AniList 候选预览确认、图像增强 | 不自动覆盖元数据；增强只改显示副本，巨图与多帧保留原图 |
| C1 / C2 | 已实现亮度、暖色及时段、虚拟全览网格 | G 全览、E 增强；偏好按系列与全局默认记忆 |
| C3 | 已实现 SQLite 自动快照与恢复 | WAL 一致性备份、保留数量、恢复校验与安全快照；不复制漫画文件 |
| C4 / C5 | 已实现 ComicInfo 回写与可解除的逻辑合并 | ZIP 副本逐页验证、其他单文件写 sidecar；不自动删重复章节或搬动原文件 |
| D1 | 已接入 115，原“不建议接第二网盘”的状态已过时 | 后续重点是两家网盘的一致性与故障恢复 |
| D2 / D3 | 未实现 OCR 翻译、多窗口阅读 | 暂不作为优先项 |


## 0. 通用上下文块（所有提示词都建议前置）

如果目标 AI 已在本项目工作区中（能读到源码），可省略下面这段（它工作区里的 `AGENTS.md` 内容相同）；否则请把这段放在每条提示词前面：

```
项目：雨读 Yudu — 本地 + 天翼云盘 / 115 网盘漫画阅读器，代码在 D:\work\Yiben。
技术栈：Electron 44 + React 18 + TypeScript + Vite（electron-vite）+ Tailwind v4 + zustand
        + react-router-dom（HashRouter）+ better-sqlite3 + sharp。包管理器 pnpm。
目录：src/main（主进程，含 archives/cloud189/cloud115/cloud/scanner/db）、
      src/preload（contextBridge）、src/renderer/src（React）、src/shared（共享类型）。
命令：pnpm dev（开发）、pnpm typecheck（主进程+渲染进程类型检查，必须过）、pnpm test（vitest，必须过）、pnpm build。
代码约定（务必遵守）：
 1. 注释与 UI 文案一律中文；代码标识符用英文。
 2. 所有 SQLite 参数必须用绑定参数（? 或 @name），禁止字符串拼接 SQL。
 3. schema 变更走 src/main/db/index.ts 的 migrate()：新表用 CREATE TABLE IF NOT EXISTS
    加进那段 db.exec(...)，新列用文件里已有的 tryAlter('ALTER TABLE xxx ADD COLUMN yyy ...')。
 4. 主进程新能力一律通过 IPC 暴露，步骤是：
    ① src/main/ipc.ts 的 registerIpc() 里加 ipcMain.handle('模块:动作', ...)
    ② src/preload/index.ts 的 api 对象里加对应方法（带精确 TS 类型）
    ③ 渲染层用 window.yudu.模块.动作() 调用
    绝不新增 ipcRenderer.sendSync，绝不在渲染层直接 require Node 模块。
 5. 主进程向渲染层推事件用 src/main/events.ts 的 broadcast('事件名', payload)，
    渲染层在 preload 的 events 命名空间下注册 onXxx 并返回取消函数。
 6. 新增页面：在 src/renderer/src/routes/ 下建组件，到 src/renderer/src/App.tsx 的 Routes 里加路由；
    侧边栏入口加到 src/renderer/src/components/layout/AppShell.tsx 的 navItems 数组。
 7. 数据库写入密集的批量操作要包在 db.transaction(...) 里。
 8. 完成后必须跑通 pnpm typecheck 与 pnpm test，并补上对应单元测试。
```

---

## 目录

| 档位 | 功能                                      | 预估    |
| -- | --------------------------------------- | ----- |
| A1 | [阅读统计与热力图](#a1-阅读统计与热力图)                | 1 天   |
| A2 | [文件关联：双击 cbz 直接打开](#a2-文件关联双击-cbz-直接打开) | 0.5 天 |
| A3 | [虚拟书架与自定义标签](#a3-虚拟书架与自定义标签)            | 1.5 天 |
| A4 | [库体检：损坏与重复检测](#a4-库体检损坏与重复检测)           | 1 天   |
| B1 | [WebDAV 书库源](#b1-webdav-书库源)            | 3 天   |
| B2 | [无缝条漫：跨话连续滚动](#b2-无缝条漫跨话连续滚动)           | 3 天   |
| B3 | [元数据刮削与自动匹配](#b3-元数据刮削与自动匹配)            | 3 天   |
| B4 | [图像增强：锐化与自动裁边](#b4-图像增强锐化与自动裁边)         | 2 天   |
| C1 | [护眼滤镜与色温](#c1-护眼滤镜与色温)                  | 0.5 天 |
| C2 | [缩略图全览网格](#c2-缩略图全览网格)                  | 1 天   |
| C3 | [数据库自动备份](#c3-数据库自动备份)                  | 0.5 天 |
| C4 | [ComicInfo.xml 回写](#c4-comicinfoxml-回写) | 1 天   |
| C5 | [系列去重与合并](#c5-系列去重与合并)                  | 1 天   |
| D1 | [接入第二个国内网盘](#d1-接入第二个国内网盘)              | 不建议   |
| D2 | [OCR 与翻译叠加](#d2-ocr-与翻译叠加)              | 不建议   |
| D3 | [多窗口 / 弹出阅读器](#d3-多窗口--弹出阅读器)           | 不建议   |

---

# A1 阅读统计与热力图

## 目标

记录每天的阅读行为，在首页/独立页面展示 GitHub 贡献图式的阅读热力图，以及连续打卡天数、总页数、本月 TOP 等指标。

## 为什么值得做

`progress` 表里有 `page`/`completed`/`updated_at`，但它是**状态表**（每章一行，只留最新），无法回答「我上周读了多少」。这是最能提升日活的功能，且数据模型简单。

## 现状与可复用点

- `src/main/db/index.ts`：`migrate()` 里加表；`saveProgress()`（约 590 行）是所有进度写入的唯一入口 —— **这里就是埋点位置**。
- `src/renderer/src/routes/HomePage.tsx`：已有「继续阅读」「最近添加」两个区块，统计卡片可直接挂在这里。
- `src/renderer/src/stores/data.ts`：`useDataStore.version` 是驱动列表刷新的机制。
- `src/main/ipc.ts`：`home:continue` / `home:recent` 是同类 IPC，照抄命名风格（`stats:*`）。


## 实现步骤

1. **数据层**：新建表
   ```sql
   CREATE TABLE IF NOT EXISTS reading_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
     series_id INTEGER NOT NULL,
     day TEXT NOT NULL,          -- 本地日期 YYYY-MM-DD
     pages INTEGER NOT NULL DEFAULT 0,   -- 本次增量页数（可为负）
     ms INTEGER NOT NULL DEFAULT 0,      -- 本次停留时长
     at INTEGER NOT NULL                 -- 时间戳
   );
   CREATE INDEX IF NOT EXISTS idx_log_day ON reading_log(day);
   ```
   `day` 用本地时区算（`new Date().toLocaleDateString('sv')` 直接得到 `YYYY-MM-DD`），不要用 UTC，否则晚上 8 点后阅读会算到第二天。
2. **埋点**：在 `saveProgress(chapterId, page, completed)` 里，取出同一 chapter 的旧 `page`，计算 `delta = page - oldPage`，仅当 `delta > 0` 时写一条 log。不要在这里算时长（进度保存是节流触发的，不代表停留时长）。
3. **时长**：渲染层 `ReaderPage` 已有翻页节流与 idle 计时（`IDLE_MS`）。在卸载/切话时把「本次会话累计活跃毫秒」通过新 IPC `stats:logTime` 补写进最近一条 log。更简单可靠的替代：`reading_log` 只记页数，时长单独用 `settings` 里的一个按天累计值 —— 若想省事，先只做页数。
4. **主进程查询**：`db/index.ts` 加 `readingStats(days: number)`，返回  
   `{ days: Array<{day, pages, minutes}>, streak, totalPages, totalDays, bestDay }`。  
   连续打卡用 SQL 或 JS 都行（数据量小，JS 更简单可靠）。
5. **IPC / preload**：`stats:overview`（参数 `days`）。
6. **渲染层**：新建 `src/renderer/src/routes/StatsPage.tsx`，或先挂在 `HomePage` 顶部。  
   热力图用纯 CSS grid（53 列 × 7 行），不要用图表库；色阶复用 Tailwind 主题色，5 档。

## 验收标准

- [ ] 读 10 页后，热力图当天格子变色，总页数 +10
- [ ] 跨天阅读产生两条记录；连续两天阅读 `streak = 2`
- [ ] 回退翻页（页数减少）不产生负增量记录
- [ ] 删除书库后，对应 log 随 chapters 级联删除
- [ ] 新增 `src/main/db/stats.test.ts` 覆盖：增量计算、跨天边界、连续打卡
- [ ] `pnpm typecheck`、`pnpm test` 通过


## 交接话术

```
【前置通用上下文块见文档第 0 节】

任务：为「雨读 Yudu」漫画阅读器增加阅读统计与热力图功能。

背景：进度保存在 SQLite 的 progress 表（每章一行，只保留最新页码），因此无法回答
「用户上周读了多少页」。需要新增按天聚合的阅读日志。

具体要求：
1. 在 src/main/db/index.ts 的 migrate() 中新增 reading_log 表：
   (id, chapter_id REFERENCES chapters(id) ON DELETE CASCADE, series_id, day TEXT, pages INTEGER, ms INTEGER, at INTEGER)
   并建 idx_log_day 索引。day 为本地时区的 YYYY-MM-DD（提示：new Date().toLocaleDateString('sv')）。

2. 埋点位置是同文件里的 saveProgress(chapterId, page, completed)。在写入前先 SELECT 出该
   chapter_id 的旧 page，计算 delta = page - 旧 page，仅 delta > 0 时 INSERT 一条 reading_log
   （旧记录不存在时 delta 视为 page + 1）。必须用绑定参数。

3. 在同文件新增导出函数：
   export interface ReadingStats {
     days: Array<{ day: string; pages: number }>
     streak: number        // 截至今天（或昨天）的连续阅读天数
     totalPages: number
     totalDays: number
     bestDay: { day: string; pages: number } | null
   }
   export function readingStats(days: number): ReadingStats
   只统计最近 days 天（默认 365）。streak 用 JS 计算即可，数据量很小。

4. 在 src/main/ipc.ts 的 registerIpc() 注册 ipcMain.handle('stats:overview', (_e, days: number) =>
   readingStats(days ?? 365))；在 src/preload/index.ts 的 api 对象里加同名方法并给出精确返回类型。

5. 新建 src/renderer/src/routes/StatsPage.tsx：
   - 顶部四个指标卡：连续天数 / 累计页数 / 阅读天数 / 最佳单日（复用 src/renderer/src/components/ui 的现有风格）
   - 下方 GitHub 风格热力图：53 列 × 7 行纯 CSS grid，5 档色阶用 Tailwind 主题色，
     鼠标悬停显示「2026-09-11 · 37 页」。不要引入图表库。
   - 用 src/renderer/src/hooks/useAsync.ts 拉取数据，加载态用现有 Skeleton 组件。
6. 路由加到 src/renderer/src/App.tsx（path="/stats"），侧边栏入口加到
   src/renderer/src/components/layout/AppShell.tsx 的 navItems（图标用 lucide-react 的 BarChart3）。

约束：所有 SQL 用绑定参数；注释与 UI 文案中文；不要引入新依赖。
验收：pnpm typecheck 与 pnpm test 均通过；新增 src/main/db/stats.test.ts 覆盖
「增量计算」「跨天边界」「连续打卡中断」三个用例。
完成后简要说明改了哪些文件、热力图长什么样。
```

---

# A2 文件关联：双击 cbz 直接打开

## 目标

在系统中把 `.cbz / .cbr / .cb7 / .cbt / .pdf` 关联到一本，双击文件直接用阅读器打开。

## 为什么值得做

成本极低（半天），但是「这是个正经软件」的信号。

## 现状与可复用点

- `src/main/index.ts`：`app.whenReady().then(...)` 是启动入口，目前**没有**单实例锁 —— 这个功能必须补上。
- `src/renderer/src/App.tsx`：`LaunchResume` 已经会用 `navigate('/reader/${id}')` 跳转，模式可复用。

## 实现步骤

1. **单实例锁**（前置，必须）：`main/index.ts` 顶部
   ```ts
   const gotLock = app.requestSingleInstanceLock()
   if (!gotLock) { app.quit() } else {
     app.on('second-instance', (_e, argv) => { handleArgv(argv) })
   }
   ```
2. **取文件路径**：Windows 上第二个实例的启动参数在 `process.argv`，形如 `['...Yudu.exe', 'D:\\a.cbz']`。
   冷启动时读 `process.argv`，热启动（已有实例）走 `second-instance` 的 argv。macOS 走 `open-file` 事件。
3. **建临时书库**：单文件不应污染书架。推荐做法 —— 求该文件所在目录，若目录已在某个书库内就直接查库拿 series/chapter；否则用 `addLibrary()` 建一个名为「临时」的书库并扫描，或更轻量：直接按 `scanOneLocalSeries` 的 `isSingleFile` 模式入库。  
   **注意**：`addLibrary` 有 `ON CONFLICT(path) DO UPDATE`，重复添加同一目录是幂等的，可以放心调用。
4. **通知渲染层**：`broadcast('app:openFile', { chapterId })`，渲染层监听后 `navigate('/reader/'+chapterId)`。  
   注意：冷启动时窗口尚未创建，要等 `ready-to-show` 之后再广播，或先存到一个模块级变量里等窗口就绪。

## 验收标准

- [ ] 双击未关联的 cbz，一本启动并直接进阅读器
- [ ] 一本已运行时双击第二个文件，不新开实例，当前窗口切到该文件
- [ ] 同目录重复双击不会重复入库
- [ ] 非支持扩展名被忽略


## 交接话术

```
【前置通用上下文块见文档第 0 节】

任务：给「雨读 Yudu」增加系统文件关联 —— 双击 .cbz/.cbr/.cb7/.cbt/.pdf 直接用阅读器打开。

背景：src/main/index.ts 是 Electron 启动入口，目前没有单实例锁。路由是 HashRouter，
阅读器路由为 /reader/:chapterId（见 src/renderer/src/App.tsx）。

要求：
1. 先补单实例锁（这是本功能的前提）：在 src/main/index.ts 顶部调用 app.requestSingleInstanceLock()，
   拿不到锁就 app.quit()；拿到锁则注册 app.on('second-instance', (_e, argv) => ...)。

2. 新增 src/main/openFile.ts，导出 handleArgv(argv: string[]): void：
   - 从 argv 里挑出扩展名属于 ['.cbz','.cbr','.cb7','.cbt','.pdf'] 的第一个现存文件路径
   - 用 src/main/db/index.ts 的 addLibrary(name, path) 把该文件「所在目录」登记为书库
     （该函数对同一 path 是幂等的，可放心重复调用）
   - 调用 src/main/scanner/index.ts 的 scanOneLocalSeries(libraryId, { folder, isSingleFile }) 入库
   - 取到 chapter 后 broadcast('app:openFile', { chapterId })
   - 找不到/不支持的格式静默忽略，不要弹错误框

3. 冷启动：在 main/index.ts 的 app.whenReady().then(...) 里，创建窗口后调用 handleArgv(process.argv)。
   注意窗口要等 ready-to-show 才 ready，若广播早于窗口创建，请把 chapterId 暂存到模块级变量，
   等 ready-to-show 时再 broadcast，避免渲染层收不到。

4. preload 的 events 命名空间加 onOpenFile(cb) ，渲染层在 src/renderer/src/App.tsx 里
   新增一个 <OpenFileBridge /> 组件监听并 navigate(`/reader/${chapterId}`)。

5. 打包配置：在 electron-builder.yml 的 win 段加 fileAssociations（ext/name/description/icon），
   mac 段加相应的 fileAssociations；并在 package.json 的 build.win 同步一份。

约束：不要因为这个功能破坏现有的「启动时恢复上次阅读」（App.tsx 的 LaunchResume）——
如果收到了待打开的文件，恢复逻辑应让位。
验收：pnpm typecheck 通过；手动验证「冷启动双击」「已运行时双击」两条路径。
```

---

# A3 虚拟书架与自定义标签

## 目标

用户能创建「书架分组」（如「追更中」「已完结」「想重读」）并给系列打自定义标签，书架页支持按分组/标签筛选。

## 为什么值得做

现在只有 `all / unread / reading / read / recent` 五个硬编码筛选（`src/main/db/index.ts` 的 `listSeries`），藏书一多就不够用了。这是库管理最大的短板。

## 现状与可复用点

- `listSeries(opts)` 的 `filter` 分支是 if/else 链，加一个 `shelf`/`tag` 分支即可。
- `src/shared/types.ts` 的 `SeriesFilter` 类型需要扩展。
- `src/renderer/src/routes/LibraryPage.tsx` 顶部是筛选器 UI。


## 实现步骤

1. **数据层**
   ```sql
   CREATE TABLE IF NOT EXISTS shelves (
     id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, sort INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE IF NOT EXISTS series_shelves (
     series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
     shelf_id INTEGER NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
     added_at INTEGER NOT NULL, PRIMARY KEY (series_id, shelf_id)
   );
   CREATE TABLE IF NOT EXISTS tags (
     id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE
   );
   CREATE TABLE IF NOT EXISTS series_tags (
     series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
     tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
     PRIMARY KEY (series_id, tag_id)
   );
   ```
   注意：`series.tags` 已存在（ComicInfo 导入的，JSON 字符串）。**不要复用它**，自定义标签走关联表，两者在 UI 上分开显示。
2. **IPC**：`shelves:list` / `shelves:create` / `shelves:rename` / `shelves:remove` /  
   `shelves:setForSeries(seriesId, shelfIds[])` / `tags:list` / `tags:setForSeries(seriesId, names[])`。  
   写入要包 `db.transaction`。
3. **listSeries 扩展**：`opts.shelfId` → `s.id IN (SELECT series_id FROM series_shelves WHERE shelf_id = @shelfId)`；  
   `opts.tags?: string[]` → 多个 `EXISTS` 条件（AND 语义）。
4. **UI**：`LibraryPage.tsx` 筛选栏加一排书架 chip（侧边或顶部）；`SeriesPage.tsx` 加「加入书架 / 标签编辑」入口（弹层，可多选 + 新建）。

## 验收标准

- [ ] 新建书架 → 勾选若干系列 → 书架页按书架筛选命中
- [ ] 系列页可加/删标签，输入新标签即时创建
- [ ] 删除书架不影响系列本身；删除系列时关联行级联清理
- [ ] ComicInfo 自带的 tags 与自定义标签互不干扰
- [ ] 批量「移出书架」时关联行一并清理


## 交接话术

```
【前置通用上下文块见文档第 0 节】

任务：给「雨读 Yudu」增加「虚拟书架（分组）」与「自定义标签」。

背景：书架筛选目前是硬编码的五档 all/unread/reading/read/recent，见
src/main/db/index.ts 的 listSeries(opts)，filter 分支是一串 if/else。
注意：series 表已有 tags 列（ComicInfo 导入的 JSON 字符串），本次的自定义标签
是另一套，请走新的关联表，两者在 UI 上分开显示，不要混用。

要求：
1. 在 migrate() 里新增 4 张表（都要带 ON DELETE CASCADE）：
   shelves(id, name UNIQUE, sort)
   series_shelves(series_id, shelf_id, added_at, PRIMARY KEY(series_id, shelf_id))
   tags(id, name UNIQUE)
   series_tags(series_id, tag_id, PRIMARY KEY(series_id, tag_id))

2. 在 src/main/db/index.ts 新增导出（批量写入请包 db.transaction）：
   listShelves() / createShelf(name) / renameShelf(id, name) / removeShelf(id)
   setSeriesShelves(seriesId, shelfIds: number[])
   listTags() / setSeriesTags(seriesId, names: string[])   // 不存在的 name 自动创建
   并给 listSeries 的 SeriesListOptions 增加 shelfId?: number 与 tags?: string[] 两个可选条件：
   shelfId → s.id IN (SELECT series_id FROM series_shelves WHERE shelf_id = @shelfId)
   tags → 每个标签一个 EXISTS 子查询（AND 语义）

3. IPC + preload：shelves:list / shelves:create / shelves:rename / shelves:remove /
   shelves:setForSeries / tags:list / tags:setForSeries，全部带精确类型。

4. UI：
   - src/renderer/src/routes/LibraryPage.tsx 的筛选栏下方加一排书架 chip（含「全部」），
     点击切换筛选；选中态沿用现有 active 样式。
   - src/renderer/src/routes/SeriesPage.tsx 加一个「书架与标签」入口按钮，点开是弹层：
     书架多选（可新建）、标签输入（回车创建、× 删除）。改完调用
     src/renderer/src/stores/data.ts 的 bump() 让列表刷新。
5. src/shared/types.ts 的 SeriesFilter 视需要扩展。

约束：SQL 全部绑定参数；删除系列/书库时靠外键级联，不要留下孤儿行。
验收：pnpm typecheck 与 pnpm test 通过；补 db 层单测覆盖 setSeriesShelves 的
「全量替换」语义（传空数组应清空）与级联删除。
```

---

# A4 库体检：损坏与重复检测

## 目标

扫描时顺带诊断，在设置页给出一份「体检报告」：解压失败的章节、空章节、疑似重复的系列、孤立缩略图文件。

## 为什么值得做

扫描本来就在跑全库，加检测几乎零成本，而且能顺手解决审查报告里发现的孤儿文件问题。

## 现状与可复用点

- `src/main/scanner/index.ts`：扫描主流程，已有 `scan_error` 字段（`src/shared/types.ts` 的 `Chapter.scan_error`）—— 说明已预留但可能未充分使用。
- `src/main/archives/index.ts`：`withDriver()` 是「用完即关」的安全打开方式，检测时用它，不要用 `getDriver`（后者会常驻 LRU）。
- `src/main/thumbnail.ts` / `pageThumb.ts`：封面与页缩略图路径规则。

## 实现步骤

1. **数据**：`chapters` 表已有 `scan_error`（用 `tryAlter` 确保列存在）。扫描列页失败时写入原因而不是静默跳过。
2. **检测函数**：新建 `src/main/diagnose.ts` 导出 `runDiagnose(libraryId?)`，返回
   ```ts
   interface DiagnoseReport {
     brokenChapters: Array<{ id, title, seriesId, seriesTitle, reason }>
     emptyChapters: Array<{ id, title, seriesTitle }>          // page_count = 0 且非 pdf
     duplicateSeries: Array<Array<{ id, title, folderPath }>>   // 归一化标题相同的组
     orphanThumbs: number                                       // 磁盘上存在但 DB 无对应记录
   }
   ```
   标题归一化：去空格/标点/全半角、转小写、去掉「第N卷」之类后缀后再比对。
3. **性能**：检测是重活，必须包在 `runExclusiveScan()`（`src/main/rescan.ts`）里，并复用 `scan:progress` 广播进度。
4. **UI**：设置页加「库体检」卡片，展示四类问题的数量与列表，提供「重新扫描该系列」「移出书架」快捷操作。

## 验收标准

- [ ] 故意放一个损坏 zip，体检能报出章节与失败原因
- [ ] 同名的两个系列能被识别为疑似重复
- [ ] 体检期间触发第二次体检会被拒绝（互斥生效）
- [ ] 大库（1000+ 系列）体检不卡死 UI


## 交接话术

```
【前置通用上下文块见文档第 0 节】

任务：给「雨读 Yudu」增加「库体检」诊断功能。

背景：src/main/scanner/index.ts 是本地库扫描主流程；src/shared/types.ts 的 Chapter
已预留 scan_error?: string | null 字段（请用 tryAlter 确认 chapters 表有该列，没有就加）。
src/main/rescan.ts 导出了 runExclusiveScan(fn)，用于独占型扫描任务并复用全局 scanning 标志。

要求：
1. 扫描时若列页/解压失败，把失败原因写入该章节的 scan_error 字段（成功则置 NULL），
   不要静默跳过 —— 这是体检的数据来源。

2. 新建 src/main/diagnose.ts，导出：
   export interface DiagnoseReport {
     brokenChapters: Array<{ id: number; title: string; seriesId: number; seriesTitle: string; reason: string }>
     emptyChapters: Array<{ id: number; title: string; seriesTitle: string }>
     duplicateSeries: Array<Array<{ id: number; title: string; folderPath: string }>>
     orphanThumbBytes: number
   }
   export async function runDiagnose(libraryId?: number): Promise<DiagnoseReport>
   检测项：
   - brokenChapters：chapters.scan_error IS NOT NULL 的行
   - emptyChapters：page_count = 0 且 kind != 'pdf' 的行
   - duplicateSeries：按「归一化标题」分组，组内数量 > 1 的组。归一化规则：
     去空白与标点、全角转半角、转小写、剥掉末尾的「第N卷/Vol.N/vol N」之类卷次后缀
   - orphanThumbBytes：遍历 app.getPath('userData')/thumbs/pages 下所有 chapterId 目录，
     若 DB 的 chapters 表无对应 id，累加其字节数（只统计，不删除）

3. 打开压缩包做校验时务必用 src/main/archives/index.ts 的 withDriver()（用完即关），
   不要用 getDriver()（后者会常驻 LRU 缓存，批量检测会打满句柄与内存）。

4. 整个检测包在 runExclusiveScan() 里执行，并用 broadcast('scan:progress', {...}) 报告进度，
   终态要发 phase:'done'，否则渲染层的扫描浮标会卡住（见 src/renderer/src/components/ScanIndicator.tsx）。

5. IPC + preload：diagnose:run（可选 libraryId）。
6. UI：src/renderer/src/routes/SettingsPage.tsx 增加「库体检」卡片 —— 顶部一个「开始体检」按钮，
   下面是四类结果的折叠列表；brokenChapters 每项提供「重新扫描该系列」按钮
   （调用已有的 series:rescan），duplicateSeries 每项提供「移出书架」（调用 series:remove）。

约束：只读诊断，不要在体检过程中自动删除任何文件或数据。
验收：pnpm typecheck 与 pnpm test 通过；补 src/main/diagnose.test.ts 覆盖标题归一化与
重复分组逻辑（至少 5 个用例：全半角、卷次后缀、大小写、标点、非重复不误报）。
```

---

# B1 WebDAV 书库源

## 目标

除天翼云盘外，支持把任意 WebDAV 目录（NAS、alist、坚果云、Box、nextcloud…）加成书库，享受同样的缓存/离线预取能力。

## 为什么值得做

标准协议、天然支持 Range，实现量约为天翼云盘的三分之一，覆盖人群反而更广。

## 现状与可复用点（关键）

- `src/main/cloud189/ensure.ts`：「确保本地有这个文件」的抽象 —— WebDAV 直接复用这套语义。
- `src/main/archives/remoteZip.ts`：HTTP Range 直读 zip（解析中央目录 → 按页取字节）。WebDAV 支持 Range，**可直接复用**。
- `src/main/cloud189/cache.ts`：LRU 缓存 + 3 并发限流 + 串行原子索引落盘 —— 这套与具体云无关，建议抽成通用层再给 WebDAV 用。
- `src/main/db/index.ts`：`libraries.kind` 是字符串，`addLibrary(name, path, kind)` 已参数化。

## 实现步骤

1. **凭据**：WebDAV 的 url/用户名/密码同样走 `safeStorage` 加密存 `settings`（参照 `src/main/cloud189/client.ts` 的 `StoredCred` 模式）。  
   **注意**：审查中发现天翼的 token 是明文落盘的（已列为待修项），WebDAV 这边别重蹈覆辙，直接加密。
2. **客户端**：新建 `src/main/webdav/client.ts`，用全局 `fetch`（Node 18+ 自带）实现  
   `propfind(path)`（返回 XML，项目已依赖 `fast-xml-parser`，直接用它解析）、`get(path, range?)`。  
   不要引入 `webdav` npm 包，自己实现 PROPFIND 更可控。
3. **书库路径**：`addLibrary(name, 'webdav://' + host + basePath, 'webdav')`，连接信息存 `settings`（键名 `webdav-cred`）或复用 `libraries` 的 cloud meta 列。
4. **扫描**：`src/main/webdav/scanner.ts`，递归 PROPFIND 列目录，目录结构与本地扫描器一致（单系列/多系列两种布局的识别逻辑直接照搬 `cloud189/scanner.ts`）。
5. **读页**：`ensure.ts` 那套 —— 散图按页下载，压缩包走 remoteZip 的 Range 直读（不支持 Range 时回退整包）。
6. **UI**：`CloudPage.tsx` 增加 WebDAV 区块（输入地址/账号/密码 → 连接 → 目录浏览器）。

## 验收标准

- [ ] 能连上一个 WebDAV，列出目录，加成书库并扫描入库
- [ ] 阅读时按页 Range 取图，首屏秒开
- [ ] 整系列离线预取可用，断网后可读
- [ ] 缓存容量上限与清理对 WebDAV 同样生效
- [ ] 连接失败/404/401 有明确中文报错


## 交接话术

```
【前置通用上下文块见文档第 0 节】

任务：给「雨读 Yudu」增加「库体检」诊断功能。

背景：src/main/scanner/index.ts 是本地库扫描主流程；src/shared/types.ts 的 Chapter
已预留 scan_error?: string | null 字段（请用 tryAlter 确认 chapters 表有该列，没有就加）。
src/main/rescan.ts 导出了 runExclusiveScan(fn)，用于独占型扫描任务并复用全局 scanning 标志。

要求：
1. 扫描时若列页/解压失败，把失败原因写入该章节的 scan_error 字段（成功则置 NULL），
   不要静默跳过 —— 这是体检的数据来源。

2. 新建 src/main/diagnose.ts，导出：
   export interface DiagnoseReport {
     brokenChapters: Array<{ id: number; title: string; seriesId: number; seriesTitle: string; reason: string }>
     emptyChapters: Array<{ id: number; title: string; seriesTitle: string }>
     duplicateSeries: Array<Array<{ id: number; title: string; folderPath: string }>>
     orphanThumbBytes: number
   }
   export async function runDiagnose(libraryId?: number): Promise<DiagnoseReport>
   检测项：
   - brokenChapters：chapters.scan_error IS NOT NULL 的行
   - emptyChapters：page_count = 0 且 kind != 'pdf' 的行
   - duplicateSeries：按「归一化标题」分组，组内数量 > 1 的组。归一化规则：
     去空白与标点、全角转半角、转小写、剥掉末尾的「第N卷/Vol.N/vol N」之类卷次后缀
   - orphanThumbBytes：遍历 app.getPath('userData')/thumbs/pages 下所有 chapterId 目录，
     若 DB 的 chapters 表无对应 id，累加其字节数（只统计，不删除）

3. 打开压缩包做校验时务必用 src/main/archives/index.ts 的 withDriver()（用完即关），
   不要用 getDriver()（后者会常驻 LRU 缓存，批量检测会打满句柄与内存）。

4. 整个检测包在 runExclusiveScan() 里执行，并用 broadcast('scan:progress', {...}) 报告进度，
   终态要发 phase:'done'，否则渲染层的扫描浮标会卡住（见 src/renderer/src/components/ScanIndicator.tsx）。

5. IPC + preload：diagnose:run（可选 libraryId）。
6. UI：src/renderer/src/routes/SettingsPage.tsx 增加「库体检」卡片 —— 顶部一个「开始体检」按钮，
   下面是四类结果的折叠列表；brokenChapters 每项提供「重新扫描该系列」按钮
   （调用已有的 series:rescan），duplicateSeries 每项提供「移出书架」（调用 series:remove）。

约束：只读诊断，不要在体检过程中自动删除任何文件或数据。
验收：pnpm typecheck 与 pnpm test 通过；补 src/main/diagnose.test.ts 覆盖标题归一化与
重复分组逻辑（至少 5 个用例：全半角、卷次后缀、大小写、标点、非重复不误报）。
```

---

# B2 无缝条漫：跨话连续滚动

## 目标

条漫模式下，滚到当前话末尾自动拼接下一话，用户全程无需手动切话。

## 为什么值得做

目前条漫仍按话切分，读到话末要手动进下一话 —— 这与条漫「一路往下刷」的体验是冲突的。

## 现状与可复用点

- `src/renderer/src/routes/reader/ImageViewer.tsx` 的 `WebtoonViewer`：当前是单话页列表。
- `src/renderer/src/routes/reader/ReaderPage.tsx`：跨话导航（末页进下一话）、`reader:neighbors`、前后话首/末页预取都已实现。
- `src/renderer/src/stores/reader.ts`：`page` / `pageCount` 状态机，已有 `reader.test.ts`（30 个用例）—— 改动务必不破坏现有测试。

## 实现步骤

1. **数据模型**：把「单话」扩展为「按系列方向拼接的章节序列」。  
   `neighborChapters(chapterId)` 已返回 `index/total/prev/next`，用它构造一个  
   `chapters: Chapter[]`（当前话 ± N 话的窗口）。
2. **虚拟列表**：用项目已依赖的 `@tanstack/react-virtual` 做「跨话统一索引」的虚拟滚动 ——  
   把 (chapterIndex, pageIndex) 映射成全局 flatIndex，滚动位置据此换算。  
   这是本功能最难的一处：滚动锚点在话与话拼接时不能跳。
3. **加载**：接近窗口末尾时用 `neighborChapters` 继续往后扩展窗口（无限滚动），并触发下一话的预取。
4. **进度**：当前话由「视口中心的页属于哪一话」决定；切话时按现有节流逻辑写进度。**注意审查报告里的 P0-1 竞态**（初始化 async 未校验章节是否被切走），改这块时务必一起修掉，否则会放大。
5. **降级开关**：设置页加「条漫跨话连读」开关，默认开启；关闭时回退到现有单话行为。

## 验收标准

- [ ] 条漫模式滚到末页自动加载下一话，无停顿、无跳动
- [ ] 进度随视口自动切到正确的章节
- [ ] 回滚到上一话开头同样无缝
- [ ] 现有 `reader.test.ts` 的 30 个用例全部仍通过
- [ ] 关闭开关后行为与改动前一致


## 交接话术

```
【前置通用上下文块见文档第 0 节】

任务：给「雨读 Yudu」的条漫模式实现「跨话连续滚动」（读完一话自动拼接下一话）。

背景（请先读）：
- src/renderer/src/routes/reader/ImageViewer.tsx 的 WebtoonViewer 目前只渲染单话页列表
- src/renderer/src/routes/reader/ReaderPage.tsx 已有跨话导航（末页进下一话）、
  reader:neighbors（返回 index/total/prev/next）、前后话首末页预取
- src/renderer/src/stores/reader.ts 是翻页状态机，已有 reader.test.ts 的 30 个用例，
  改动不得破坏这些用例
- 项目已依赖 @tanstack/react-virtual（书架封面墙在用）

要求：
1. 把条漫容器从「单话页列表」改成「跨话拼接的虚拟列表」：
   用 neighborChapters 维护一个「当前话 ± N 话」的章节窗口，把 (chapterIndex, pageIndex)
   映射为全局 flatIndex 交给 @tanstack/react-virtual。滚到窗口尾部时继续向后扩展窗口。
2. 关键难点是滚动锚点：新话拼接到末尾时不得引起视口跳动。请实现并说明你的锚定策略。
3. 当前话由「视口中心的页属于哪一话」推断，切换时沿用现有节流逻辑写进度。
4. 【必须同时修掉一个已知 P0 竞态】ReaderPage.tsx 第 80-104 行的初始化 useEffect 里，
   async 块在 await 之后没有校验章节是否已被切走，导致快速切话时 readyFor.current 被旧 id
   占住、当前话进度永不落库。请加：进入 async 前 const myId = chapter.id，
   apply 前 if (initFor.current !== myId) return。
5. 设置页加「条漫跨话连读」开关（默认开），关闭时完全回退到现有单话行为。
   配置键要加进 src/main/ipc.ts 的 CONFIG_KEYS 白名单，否则渲染层读写会被拒绝。

验收：pnpm typecheck 与 pnpm test 通过，reader.test.ts 的 30 个用例必须全绿；
补 src/renderer/src/stores/reader.test.ts 中「跨话 flatIndex 换算」的用例。
手动验证：连读三话无跳动、回滚到上一话开头无跳动、关闭开关后行为与之前一致。
```

---

# B3 元数据刮削与自动匹配

## 目标

从公开漫画数据源（Bangumi 等）按标题抓取封面、作者、简介、标签，用户确认后写入。

## 为什么值得做

手动编辑元数据的体验已有，但录入成本高。

## 风险（务必先确认）

- 数据源的 **ToS 与合规**：Bangumi 有公开 API（需确认当前可用性与调用限制），请勿高频请求或用于商业用途。
- 网络不可达、被墙、接口变更都是常态 —— 必须有超时、重试、明确的失败提示，且**绝不能阻塞扫描**。

## 实现步骤

1. `src/main/metadata/bangumi.ts`：搜索（按标题）→ 取详情 → 归一化为 `{ title, author, description, tags, coverUrl, year }`。  
   `fetch` 必须带 `AbortSignal.timeout(8000)`，失败静默返回空结果。
2. 匹配策略：标题归一化后精确匹配优先，其次模糊匹配；**永远给用户确认**，不做自动写入。
3. 封面下载后走 `sharp` 转成与现有封面一致的 400×560 WebP（参照 `src/main/thumbnail.ts` 的 `generateCover`）。
4. UI：`SeriesPage.tsx` 加「从网络获取元数据」按钮 → 候选列表 → 勾选要覆盖的字段 → 应用（走已有的 `series:updateMeta`，会自动打 `meta_edited=1`）。
5. 设置页加开关（默认关闭），并在 UI 上说明数据来源于第三方。

## 验收标准

- [ ] 搜一个热门作品能在 3 秒内返回候选
- [ ] 网络失败时按钮变灰并给出提示，不崩溃、不卡扫描
- [ ] 应用后可勾选字段，未勾选的字段不被覆盖
- [ ] 应用后 `meta_edited=1`，重扫不覆盖


## 交接话术

```
【前置通用上下文块见文档第 0 节】

任务：给「雨读 Yudu」增加「网络元数据刮削」—— 按标题从公开漫画数据源抓取元数据。

重要前提（请在实现前确认并在代码注释里写明）：
- 请优先使用 Bangumi（bgm.tv）的公开 API。实现前先实际验证接口可用性、鉴权要求与
  调用频率限制，并在代码里做好限流（建议串行 + 最小 200ms 间隔）。
- 不得高频抓取、不得用于商业用途；若接口要求 User-Agent 请如实填写本项目信息。
- 若验证后发现接口不可用或条款不允许，请停下来告诉我，不要自己换一个来路不明的源。

要求：
1. 新建 src/main/metadata/bangumi.ts，导出
   search(title: string): Promise<Candidate[]>
   Candidate = { sourceId: string; title: string; author: string | null; description: string | null;
                 tags: string[]; year: number | null; coverUrl: string | null }
   所有 fetch 必须带 AbortSignal.timeout(8000)，任何失败都返回空数组，绝不抛到调用方。
2. 匹配：标题归一化（去空白标点、全角转半角、小写）后先精确匹配，无结果再做模糊匹配，
   结果按相关度排序，最多返回 8 条。永远只做「候选」，不自动写入数据库。
3. 封面：下载后交给 sharp 处理成与现有封面一致的规格（400×560 WebP、fit cover、
   position top、quality 82；参照 src/main/thumbnail.ts 的 generateCover），
   落盘路径用同文件的 thumbPath(seriesId)。
4. IPC + preload：metadata:search(title) / metadata:apply(seriesId, patch, coverUrl?)。
   apply 内部复用现有 db 的 updateSeriesMeta（会自动打 meta_edited=1，重扫不覆盖），
   并调用 rebuildFts() 让搜索立即命中。
5. UI：src/renderer/src/routes/SeriesPage.tsx 加「从网络获取元数据」按钮，点开是候选列表；
   选中后进入字段勾选面板（标题/作者/简介/标签/年份/封面逐项可勾选），确认后应用。
6. 设置页加总开关（默认关闭），并在按钮旁注明数据来源于第三方、需联网。

约束：刮削必须是完全可选、可关闭的；任何网络异常都不得阻塞扫描或阅读。
验收：pnpm typecheck 与 pnpm test 通过；补 src/main/metadata/bangumi.test.ts，
用 mock 的 fetch 覆盖「成功返回」「超时」「空结果」「脏 HTML 字段」四种情况。
```

---

# B4 图像增强：锐化与自动裁边

## 目标

扫描件常见的白边、发灰、摩尔纹问题，在阅读器里提供一键优化。

## 为什么值得做

`sharp` 已经是依赖，缩略图与封面都在用，能力现成。

## 实现步骤

1. **自动裁边**：`sharp(buf).trim(threshold)` 能自动裁掉纯色边框。探测一次后按章节记进 `page_dims` 或新表，避免每页重复计算。
2. **增强**：在 `src/main/protocol.ts` 的 `page` 路由加可选查询参数（`?enhance=1&sharpen=...`），按需用 sharp 处理后再返回。**必须缓存处理结果**（可复用 `pageThumb` 那套落盘思路，另建目录），否则每次翻页都跑一次 sharp 会卡。
3. **UI**：阅读器设置（或快捷键 `E`）切换增强开关；参数（锐化强度、对比度、去摩尔纹）按系列记忆，存进现有 `readerPrefs`。
4. **性能**：sharp 在主进程跑，会阻塞事件循环。建议限制并发（复用 `cloud189/cache.ts` 的 `withDownloadSlot` 思路，或抽成通用信号量），并对大图设尺寸上限（超过则跳过）。

## 验收标准

- [ ] 开启后白边被裁掉，图像更清晰
- [ ] 处理结果有缓存，二次翻页无延迟
- [ ] 关闭后完全回到原图（包括缓存命中要区分开/关）
- [ ] 4K 大图不会导致主进程卡顿超时


## 交接话术

```
【前置通用上下文块见文档第 0 节】

任务：给「雨读 Yudu」的阅读器增加图像增强（自动裁边 + 锐化）。

背景：项目已依赖 sharp，封面与页缩略图都在用它（src/main/thumbnail.ts、src/main/pageThumb.ts）。
图片经 yudu:// 自定义协议返回，见 src/main/protocol.ts 的 readChapterPage / readChapterPageDedup。
阅读偏好按系列记忆，存在 settings 的 'readerPrefs' 键（见 src/main/ipc.ts 的 reader:prefs:get/set）。

要求：
1. 自动裁边用 sharp 的 trim({ threshold })；锐化用 sharpen()。
   在 src/main/protocol.ts 的 page 路由支持查询参数（如 yudu://page/{id}/{idx}?enhance=1），
   按需处理后返回。
2. 【性能是关键】绝不能每次翻页都跑 sharp：
   - 处理结果必须落盘缓存（参照 src/main/pageThumb.ts 的做法：临时文件 + rename 原子落盘，
     目录建议 app.getPath('userData')/cache/enhanced/{chapterId}/{idx}.webp）
   - 缓存 key 必须包含增强参数，否则开关切换时会命中错误的图
   - 尺寸上限：宽或高超过 4000px 的页直接跳过增强返回原图，避免主进程长耗时
   - 并发限制：sharp 在主进程同步跑会阻塞事件循环，请加一个全局信号量（最多 2 个并发），
     思路可参照 src/main/cloud189/cache.ts 的 withDownloadSlot
3. 参数：锐化强度 / 是否裁边 / 对比度，按系列记忆，复用现有 readerPrefs 结构
   （src/shared/types.ts 的 ReaderPrefs 里加可选字段），默认值在设置页可配。
4. UI：阅读器顶栏（src/renderer/src/routes/reader/ReaderChrome.tsx）加一个增强开关按钮，
   快捷键用 E；参数调节放在设置页。快捷键帮助面板
   （src/renderer/src/routes/reader/KeyboardHelp.tsx）要同步加上 E 的说明。

约束：增强功能默认关闭；关闭时必须完全走原图路径，不能有任何额外开销。
验收：pnpm typecheck 与 pnpm test 通过；手动验证「开启后二次翻页无延迟」
「开关切换不会命中错误缓存」「4K 图不卡顿」三点。
```

---

# C1 护眼滤镜与色温

## 目标

阅读器叠加一层可调色温/亮度的滤镜，夜间阅读更舒适；支持按系统时间自动开启。

## 实现要点

- 这是**纯渲染层**改动，不需要动主进程：在阅读器图片容器上叠一个 `pointer-events-none` 的覆盖层，用 `mix-blend-mode: multiply` + 橙色半透明即可模拟降蓝光；亮度用 `filter: brightness()`。
- 更彻底的做法是 `filter: sepia() saturate()` 组合，但性能开销大，优先用叠加层。
- 参数存 `readerPrefs`（按系列）或全局设置，设置页加滑块。
- 「跟随系统时间自动开启」可用 `matchMedia('(prefers-color-scheme: dark)')` 或按小时判断。

## 交接话术

```
【前置通用上下文块见文档第 0 节】

任务：给「雨读 Yudu」的阅读器加护眼滤镜（色温 / 亮度可调，可跟随系统时间自动开启）。

要求（本功能应完全在渲染层实现，不要动主进程，不要引新依赖）：
1. 在 src/renderer/src/routes/reader/ImageViewer.tsx 的图片容器上叠加一个覆盖层：
   pointer-events-none、绝对定位铺满、mix-blend-mode: multiply、背景为可调透明度的橙色
   （模拟降蓝光）；亮度另一档用外层容器的 filter: brightness()。
   不要用 filter: sepia() 之类全图滤镜链，大图上性能差。
2. 参数：warmth（0-100）、brightness（50-150）、auto（boolean，按本地时间 20:00-07:00 自动开启，
   或跟随 prefers-color-scheme）。存进现有 readerPrefs（src/shared/types.ts 的 ReaderPrefs 加可选字段），
   全局默认值放在设置页。
3. UI：设置页加一组滑块 + 「日落到日出自动开启」开关；阅读器顶栏
   （src/renderer/src/routes/reader/ReaderChrome.tsx）加一个快速开关按钮（图标用 lucide-react 的 Moon / Sun）。
4. 条漫模式（WebtoonViewer）也要生效，不要只做单页模式。

验收：pnpm typecheck 通过；手动验证单页/双页/条漫三种模式下滤镜都生效，
且不影响点击翻页的左右 1/3 热区（覆盖层必须 pointer-events-none）。
```

---

# C2 缩略图全览网格

## 目标

阅读器内打开一个全页缩略图网格，快速跳转到任意页（也可用于找某一幕）。

## 实现要点

- 数据现成：`yudu://page-thumb/{chapterId}/{index}` 已能取到缩略图（`src/main/pageThumb.ts`）。
- 页数可能未知（云端压缩包 `pageCount=0`），此时按已知值展示并在收到 `chapter:pageCount` 广播后扩展。
- 用 `@tanstack/react-virtual` 做网格虚拟化，别一次渲染几百个 `<img>`。
- 当前页高亮 + 自动滚动到视野内；点击跳转调用现有 `setPage`。


## 交接话术

```
【前置通用上下文块见文档第 0 节】

任务：给「雨读 Yudu」阅读器加「缩略图全览网格」面板（快捷键 G 打开）。

背景：
- 缩略图已可通过 yudu://page-thumb/{chapterId}/{index} 取得（主进程 sharp 生成并落盘缓存，
  见 src/main/pageThumb.ts 与 src/main/protocol.ts 的 page-thumb 路由），直接用 <img> 加载即可
- 项目已依赖 @tanstack/react-virtual，书架封面墙 src/renderer/src/components/library/CoverGrid.tsx 是现成范例
- 翻页状态机在 src/renderer/src/stores/reader.ts，跳转用现有的 setPage

要求：
1. 在 src/renderer/src/routes/reader/ 新建 ThumbnailGrid.tsx：全屏面板，网格展示本章所有页缩略图。
2. 【重要】页数可能未知：云端压缩包要整包下载后才知道页数，此时 pageCount 为 0
   （见 src/shared/types.ts 与 ReaderPage.tsx 对 pageCount 的处理）。
   请按「已知页数」渲染，并监听现有的 window.yudu.events.onChapterPageCount 广播，
   收到后扩展网格。不要在 pageCount=0 时渲染空面板或报错。
3. 用 @tanstack/react-virtual 做虚拟化，一次只渲染视口内的项 —— 几百页时不能全量挂载。
4. 当前页高亮；面板打开时自动把当前页滚动进视野；点击缩略图调用 setPage 并关闭面板。
5. 书签页加角标（书签数据用 window.yudu.bookmarks.list(seriesId)）。
6. 快捷键 G 打开、Esc 关闭；同步更新 src/renderer/src/routes/reader/KeyboardHelp.tsx。
   注意 G 不要与现有快捷键冲突（现有：方向键/空格/PageUp/PageDown/Home/End/C/D/M/S/R/T/B/F/回车/?/Esc）。

验收：pnpm typecheck 通过；手动验证 300 页的章节打开面板不卡顿、
云端未回填页数的章节能正确扩展、点击跳转准确。
```

---

# C3 数据库自动备份

## 目标

定期把 `yudu.db` 快照到用户目录，异常时可一键回滚。

## 实现要点

- 用 better-sqlite3 的 `db.backup(path)` API（同步，但官方支持且安全），或更简单：定期 `VACUUM INTO '<path>'`（生成一致性快照，不需要停写）。
- 建议：每次启动时快照一份，保留最近 7 份，超出删除最旧的。存 `%APPDATA%/雨读 Yudu/backups/yudu-YYYYMMDD-HHmmss.db`。
- 设置页展示备份列表 + 「立即备份」「恢复此备份」；恢复需二次确认（会覆盖当前进度）。
- 已有 `src/main/dataTransfer.ts`（JSON 导入导出），备份是它的补充（完整库快照）。


## 交接话术

```
【前置通用上下文块见文档第 0 节】

任务：给「雨读 Yudu」增加 SQLite 数据库自动备份与一键恢复。

背景：数据库文件是 app.getPath('userData')/yudu.db（见 src/main/db/index.ts 的 openDb），
WAL 模式。项目已有 src/main/dataTransfer.ts 做 JSON 进度导入导出，本次是它的补充
（完整库快照，包含书库结构，而不只是进度）。

要求：
1. 新建 src/main/backup.ts：
   - backupNow(): 用 SQLite 的 `VACUUM INTO '<目标路径>'` 生成一致性快照
     （比直接拷文件安全，WAL 模式下拷文件可能拿到不一致状态）。
     目标：app.getPath('userData')/backups/yudu-YYYYMMDD-HHmmss.db
   - listBackups(): 读取该目录，返回 [{ file, size, at }]
   - restore(file): 二次确认后，把当前 db 关闭 → 用备份覆盖 → 重新 openDb。
     覆盖前务必先把「当前 db」另存一份 .before-restore，留退路。
   - pruneBackups(keep = 7): 保留最近 7 份，删除更旧的
2. 启动时（src/main/index.ts 的 app.whenReady 里，openDb 之后）异步执行一次
   backupNow() + pruneBackups()，失败只 console.warn，绝不能阻断启动。
3. IPC + preload：backup:list / backup:now / backup:restore(file) / backup:prune。
4. UI：src/renderer/src/routes/SettingsPage.tsx 的「数据备份」区块内增加：
   「立即备份」按钮、备份列表（时间 + 大小）、每项一个「恢复」按钮。
   恢复前弹出明确的中文二次确认：「恢复将覆盖当前全部阅读进度与书签，且不可撤销」，
   并告知会自动留一份 .before-restore。

约束：备份与恢复都不能在扫描进行中触发（用 src/main/rescan.ts 的 isScanning() 拦截并提示）。
验收：pnpm typecheck 通过；手动验证「备份 → 改进度 → 恢复」进度正确回滚，
以及「连续启动 10 次后只保留 7 份」。
```

---

# C4 ComicInfo.xml 回写

## 目标

用户在系列页编辑的元数据，能写回压缩包内的 `ComicInfo.xml`（或散图目录写一个新的）。

## 为什么值得做

现在只写进数据库，换设备/换软件就丢了 —— 这是当前功能的明显缺口。

## 实现要点

- 读取侧已有 `src/main/scanner/comicinfo.ts`，写回 XML 可用项目已依赖的 `fast-xml-parser` 的 `XMLBuilder`。
- **压缩包内文件无法原地修改**：zip 需要重建（node-stream-zip 只读，需引入写能力或用 `archiver`）；rar 基本不可写。  
  务实的做法：**只对散图目录（folder 类型）写文件**；压缩包类型给明确提示「该格式不支持回写」。


## 交接话术

```
【前置通用上下文块见文档第 0 节】

任务：给「雨读 Yudu」增加 ComicInfo.xml 回写 —— 把用户在系列页编辑的元数据写回文件。

背景：读取侧已有 src/main/scanner/comicinfo.ts（解析 ComicInfo.xml）。项目已依赖
fast-xml-parser（可用其 XMLBuilder 生成 XML）。章节类型见 chapters.kind，
其中 'folder' 表示散图目录。

要求：
1. 新建 src/main/scanner/comicinfoWrite.ts，导出
   writeComicInfo(dirPath: string, meta: SeriesMetaPatch): Promise<void>
   按 ComicInfo 标准字段生成 XML（Title / Series / Writer / Summary / Tags / Status / Year /
   LanguageISO / Manga），写进 dirPath/ComicInfo.xml。已存在时做字段合并而非整份覆盖。
   用 fast-xml-parser 的 XMLBuilder，声明头带 encoding="utf-8"。

2. 【重要限制】压缩包内的文件无法原地修改（rar 基本不可写，zip 需要重建整个归档）。
   因此本功能只支持 chapters.kind === 'folder' 的散图目录章节；
   压缩包类型请在 UI 上明确提示「该格式不支持回写，元数据仅保存在一本内」，
   不要尝试实现压缩包重写。

3. IPC + preload：series:writeComicInfo(seriesId)，内部取该系列的第一个 folder 类型章节
   （按 sort_index 最小）作为写入目标，成功返回写入路径，失败返回中文原因。

4. UI：src/renderer/src/routes/SeriesPage.tsx 的元数据编辑区加一个
   「写回 ComicInfo.xml」按钮；写入成功给 toast 提示路径，
   不支持的格式把按钮置灰并给出说明。

约束：写文件前先备份原文件为 ComicInfo.xml.bak（存在就不再覆盖，避免反复污染）。
验收：pnpm typecheck 与 pnpm test 通过；补 src/main/scanner/comicinfoWrite.test.ts，
用临时目录覆盖「新建」「字段合并」「特殊字符转义」三种情况。
```

---

# C5 系列去重与合并

## 目标

识别同一部作品被扫成多个系列（不同目录、不同命名），支持合并进度。

## 实现要点

- 归一化标题分组（与 A4 库体检共用归一化函数，建议抽到 `src/main/scanner/parse.ts`）。
- 合并策略：保留一个主系列，把其余系列的 chapters 重新指向主系列（`UPDATE chapters SET series_id = ?`），  
  进度取并集里更靠后的，然后删除被合并的系列并清理其封面/缩略图。
- **必须先备份**：建议合并前自动触发一次 C3 的备份。
- UI 上只做「候选提示 + 手动确认合并」，绝不自动合并。


## 交接话术

```
【前置通用上下文块见文档第 0 节】

任务：给「雨读 Yudu」增加「疑似重复系列检测与手动合并」。

背景：series 表字段见 src/main/db/index.ts 的 SeriesRow（id, library_id, title, folder_path 等）；
chapters 通过 series_id 外键关联并带 ON DELETE CASCADE；进度在 progress 表（按 chapter_id 主键）。
标题解析工具在 src/main/scanner/parse.ts（请把归一化函数放这里，便于与库体检功能共用）。

要求：
1. 在 src/main/scanner/parse.ts 导出
   normalizeTitle(title: string): string
   规则：去空白与标点、全角转半角、转小写、剥掉末尾卷次后缀（第N卷 / Vol.N / vol N / 第N话 等）。

2. 新建 src/main/merge.ts，导出
   findDuplicateSeries(): Array<{ key: string; items: Array<{ id, title, folderPath, chapterCount }> }>
   mergeSeries(keepId: number, mergeIds: number[]): Promise<{ movedChapters: number }>
   mergeSeries 的执行顺序（务必包在 db.transaction 里）：
   ① 把 mergeIds 下所有 chapters 的 series_id 改为 keepId
   ② 冲突处理：若目标系列已存在相同 path 的章节，保留双方中 page 更靠后 / 有进度的那条，
      删掉另一条（chapters.path 有唯一索引，不处理会直接报错）
   ③ 删除被合并的 series 行（chapters 已迁走，progress 随 chapters 走）
   ④ 调用 src/main/thumbnail.ts 的 removeSeriesArtifacts(被删 seriesIds, []) 清理封面与页缩略图
   ⑤ 调用 rebuildFts()

3. 【安全】mergeSeries 执行前必须先做一次数据库快照备份
   （`VACUUM INTO` 到 userData/backups/，见 src/main/db/index.ts 的 openDb 拿连接）；
   合并是不可逆操作，没有备份就不要执行。

4. IPC + preload：series:findDuplicates / series:merge({ keepId, mergeIds })。
5. UI：在设置页加「重复系列」卡片 —— 「检测」按钮 → 候选分组列表 → 每组选一个主系列 →
   「合并」按钮 → 中文二次确认（显示将合并的章节数、将删除的系列数）→ 执行后 bump() 刷新。

约束：绝不自动合并，必须用户逐组确认。
验收：pnpm typecheck 与 pnpm test 通过；补 src/main/merge.test.ts 覆盖
「章节迁移」「同 path 冲突取进度更靠后者」「封面清理」「合并后 FTS 可搜到」四个用例。
```

---

# D1 接入第二个国内网盘（不建议）

**不建议的理由**：国内网盘每家都是一套私有签名、风控策略与 SDK。天翼云盘这一家你已经踩了两个坑（家庭云 `-11` 根目录需下钻到「我的应用/家庭云」、下载直链的 `&amp;` XML 实体转义），而且 `cloud189-sdk` 还拖进了已停止维护的 `got@11.8.2` 和冷门包 `@netdrive-sdk/log`。再加一家，等于把这条维护负债翻倍。

**如果确实要做**，优先顺序是：115（有成熟第三方库）> 阿里云盘（开放平台相对规范）> 其他。并且必须满足：

1. 先把 `cloud189/` 里的**通用部分**（缓存、限流、ensure 语义、Range 直读）抽成 `src/main/netsrc/` 抽象层，新网盘只实现 `listDir / getDownloadUrl / getBytes` 三个方法。
2. 凭据一律 `safeStorage` 加密，token 不得明文落盘。
3. 所有网络请求带超时。

---

# D2 OCR 与翻译叠加（不建议）

**不建议的理由**：需要引入几十 MB 的 OCR 模型和一个完全陌生的技术栈，与这个项目「轻、快、本地」的调性是冲突的。安装体积会从现在的几十 MB 涨到几百 MB，启动时间也会受影响。

**如果确实要做**，建议做成**可选的外部工具集成**而非内置：调用系统已安装的 OCR CLI，或在设置页让用户自己配一个 HTTP 端点（如自建的 manga-ocr 服务），一本只负责把当前页发给它、把返回的文本框叠加渲染。这样零体积负担，且用户可自行取舍。

---

# D3 多窗口 / 弹出阅读器（不建议）

**不建议的理由**：当前架构里 `ReaderPage` 是单窗口路由的一部分，大量状态在模块级（如 `src/renderer/src/stores/reader.ts` 的全局 store、`App.tsx` 的 `resumedInSession` 单例标志）。多窗口意味着每个窗口要有独立的 store 实例、独立的协议请求去重，改动面很大而收益有限（读漫画很少需要并排两本）。

**如果确实要做**，先做「独立阅读器窗口」（把当前阅读会话弹到新窗口，原窗口回到书架）而非「多窗口并存」，复杂度会低一个数量级。

---

## 附：建议的实施顺序

1. **A1 阅读统计**（数据现成、风险最低、见效最快）
2. **A2 文件关联** + 顺手补上审查报告里缺的单实例锁
3. **A4 库体检**（复用扫描，零边际成本）
4. **A3 虚拟书架**（库管理短板）
5. **B1 WebDAV**（第二大价值点，但要先抽通用缓存层）
6. **B2 无缝条漫**（体验最后一公里，但要连 P0 竞态一起修）

C 档的五个都是 0.5–1 天的零碎活，适合在 A/B 之间穿插做。
