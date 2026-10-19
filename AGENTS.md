# AGENTS.md — 雨读 Yudu 开发约定

给在本仓库工作的人 / AI 助手（Claude Code、Cursor、Codex 等）的项目上下文与硬性约定。
`docs/FEATURE_BACKLOG.md` 里给外部 AI 的提示词也以本文件为准（复制本文件的「项目背景」与「代码约定」两节前置即可）。

## 项目背景

雨读 Yudu — 本地 + 天翼云盘 / 115 网盘漫画阅读器，代码在仓库根目录。
技术栈：Electron 44 + React 18 + TypeScript + Vite（electron-vite）+ Tailwind v4 + zustand
+ react-router-dom（HashRouter）+ better-sqlite3 + sharp。包管理器 pnpm。
目录：`src/main`（主进程）、`src/preload`（contextBridge）、`src/renderer/src`（React）、`src/shared`（共享类型）。
主进程子模块：`archives/`（压缩包驱动，魔数嗅探兜底）、`cloud189/` 与 `cloud115/`（两家网盘）、`cloud/`（云盘共用扫描管线，按 provider 注入）、`scanner/`、`db/`、`protocol.ts`（`yudu://` 自定义协议）、`ipc.ts`、`bossKey.ts`。

架构设计（自定义协议取图、页码语义、Range 直读、增量扫描、missing 系列策略）见 README 的「关键设计」一节，动手前先读。

## 常用命令

```bash
pnpm dev        # 开发（electron-vite dev）
pnpm typecheck  # 主进程 + 渲染进程类型检查（必须过）
pnpm test       # 单元测试（vitest，必须过）
pnpm build      # 构建到 out/
pnpm dist       # 打包（electron-builder，Windows：nsis）
```

## 代码约定（务必遵守）

1. 注释与 UI 文案一律中文；代码标识符用英文。
2. 所有 SQLite 参数必须用绑定参数（`?` 或 `@name`），禁止字符串拼接 SQL。
3. schema 变更走 `src/main/db/index.ts` 的 `migrate()`：新表用 `CREATE TABLE IF NOT EXISTS`
   加进那段 `db.exec(...)`，新列用文件里已有的 `tryAlter('ALTER TABLE xxx ADD COLUMN yyy ...')`。
4. 主进程新能力一律通过 IPC 暴露，步骤是：
   ① `src/main/ipc.ts` 的 `registerIpc()` 里加 `ipcMain.handle('模块:动作', ...)`
   ② `src/preload/index.ts` 的 `api` 对象里加对应方法（带精确 TS 类型）
   ③ 渲染层用 `window.yudu.模块.动作()` 调用。
   绝不新增 `ipcRenderer.sendSync`，绝不在渲染层直接 require Node 模块。
5. 主进程向渲染层推事件用 `src/main/events.ts` 的 `broadcast('事件名', payload)`，
   渲染层在 preload 的对应命名空间下注册 `onXxx` 并返回取消函数。
6. 新增页面：在 `src/renderer/src/routes/` 下建组件，到 `src/renderer/src/App.tsx` 的 Routes 里加路由；
   侧边栏入口加到 `src/renderer/src/components/layout/AppShell.tsx` 的 `navItems` 数组。
7. 数据库写入密集的批量操作要包在 `db.transaction(...)` 里。
8. 完成后必须跑通 `pnpm typecheck` 与 `pnpm test`，并补上对应单元测试。

## 测试与无头验证

- 单元测试放 `*.test.ts` 同目录；测 DB / 主进程模块时 `vi.mock('electron', ...)` 只需 mock `app.getPath`（参考 `src/main/db/stats.test.ts`）。
- 无头自检：`FIX_ROOT=<目录> node scripts/make-fixture.js` 生成 fixture 书库，然后
  `YUDU_SELFTEST=<fixture目录> npx electron . --user-data-dir=<临时目录>` 跑 加库→扫描→读页→进度 全链路。
  **必须隔离 `--user-data-dir`**，否则会写进真实 `%APPDATA%\雨读 Yudu\yudu.db`。
- 截图 / eval 钩子（`YUDU_SCREENSHOT` / `YUDU_ROUTE` / `YUDU_THEME` / `YUDU_KEY` / `YUDU_EVAL`）已 `is.dev` 门控，
  只在未打包运行（`pnpm dev`、`npx electron .`）下生效；截图路径必须传**正斜杠**，`YUDU_ROUTE` 不带 `#/` 前缀。
- 被杀掉的 electron 可能残留进程占着单实例锁，重跑前 `taskkill //F //IM electron.exe` 清场。
- 断言优先级：读 DB / vitest > computed style > 截图像素 > 视觉模型（后者对位置/弱元素不可靠）。

## 已知怪癖（勿误判为 bug）

- `scan_error` 里 PDF 章节恒报「暂不支持的格式」——这是扫描器的能力边界声明，不是文件损坏；读 `scan_error` 的功能必须排除 `kind='pdf'`。
- 天翼家庭云 open API 的 `-11` 根目录只有默认空文件夹，真实内容在「我的应用/家庭云」，列目录时自动下钻（`cloud189/client.ts`）。
- 天翼下载直链含 XML 实体转义（`&amp;`），必须解码后再 fetch，否则 403。
- 更多实测怪癖、无头验证配方与架构不变量见 `docs/memory/`。

## 发版链

tag `v*` → GitHub Actions（`.github/workflows/release.yml`）出 NSIS 包 → 同时传 GitHub Release 与 R2 桶
（应用内更新走 `yudu-media.yeyushi.com`）。`package.json#build` 里 `npmRebuild` 必须保持 `false`；
`fileAssociations` 也在 `package.json#build`（无独立 electron-builder.yml）。更新说明写在 `RELEASE_NOTES.md`，随包携带。

## 文档地图

- `README.md` — 功能总览、快捷键、关键设计、调试钩子（人看的入口）
- `RELEASE_NOTES.md` — v0.1.0 起全部版本更新说明
- `docs/FEATURE_BACKLOG.md` — 功能候选规格 + 可复制给外部 AI 的自包含提示词
- `docs/UI_BEAUTIFICATION.md` — v0.2.0 视觉重构的设计语言（纸墨书斋 / 现代漫画），已落地，留作设计参考
- `docs/CODE_REVIEW.md` — 2026-09-11 的审查报告，**问题均已修复，仅作历史记录勿照修**
- `docs/memory/` — 实测经验沉淀：云盘接口怪癖、阅读器不变量、无头验证配方、发版约束（2026-10-19 入库）
