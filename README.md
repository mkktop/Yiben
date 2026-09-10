# 一本 Yiben

精美的本地 + 天翼云盘漫画阅读器（Electron + React）。

把漫画文件夹或天翼云盘目录加进书架即可阅读：本地支持散图文件夹与 CBZ/ZIP、CBR/RAR、CB7/7Z、CBT/TAR、PDF；
云端目录自动识别「单系列」与「多系列」两种布局，读过的内容会缓存到本地，断网也能看。

## 功能

- **书架**：封面墙（虚拟滚动）、按标题全文搜索、未读 / 在读 / 最近添加筛选
- **系列页**：ComicInfo.xml 元数据、章节列表与逐话进度、继续阅读
- **阅读器**：单页 / 双页 / 条漫三种模式；适宽 / 适高 / 原始；日漫从右往左；旋转；缩放；缩略图条；沉浸全屏
- **按系列记忆阅读偏好**（模式、适配、方向、旋转）
- **天翼云盘**：个人云 / 家庭云，凭据经系统级加密保存在本机；云端缓存带容量上限与 LRU 清理，可按系列查看和清理占用

## 环境要求

Node.js ≥ 20、pnpm。`sharp`、`better-sqlite3` 为原生依赖，安装时需要构建。

```bash
pnpm install
pnpm dev        # 开发（electron-vite dev）
pnpm typecheck  # 主进程 + 渲染进程类型检查
pnpm test       # 单元测试（vitest）
pnpm build      # 构建到 out/
pnpm dist       # 打包（electron-builder，Windows：nsis + portable）
```

## 快捷键（阅读器）

| 按键 | 作用 |
| --- | --- |
| `→` / `空格` / `PageDown` | 下一页（条漫为向下滚动一页） |
| `←` / `PageUp` | 上一页 |
| `Home` / `End` | 第一页 / 最后一页 |
| `D` | 切换双页 |
| `M` | 循环切换 单页 → 双页 → 条漫 |
| `S` | 循环切换 适宽 → 适高 → 原始 |
| `R` | 旋转 90° |
| `T` | 缩略图条 |
| `F` | 全屏 |
| `Esc` | 返回（全屏时先退出全屏） |

鼠标：左右各 1/3 区域点击翻页（日漫方向时左右互换）；`Ctrl/⌘ + 滚轮` 缩放。

## 目录结构

```
src/
  main/                 主进程
    archives/           压缩包驱动（folder / zip / rar / 7z / tar），带 LRU 缓存
    cloud189/           天翼云盘：登录、列目录、下载缓存、扫描
    scanner/            本地库扫描、文件名解析、ComicInfo.xml
    db/                 SQLite（schema 迁移、FTS5 搜索、进度）
    protocol.ts         yiben:// 自定义协议
    ipc.ts              IPC 入口（含扫描任务编排）
    pageThumb.ts        页缩略图生成与容量回收
    thumbnail.ts        系列封面生成
  preload/              contextBridge API
  renderer/src/         React 界面（路由 / 组件 / zustand store）
  shared/               主进程与渲染进程共享的类型
```

### 关键设计

- **图片走自定义协议而不是 IPC**：`yiben://page/{chapterId}/{index}` 由 `<img>` 直接加载，享受 Chromium 的解码缓存，翻页零拷贝。
  另有 `yiben://page-thumb/...`（缩略图条用，主进程 sharp 缩小后落盘）、`yiben://thumb/{seriesId}`（封面）、`yiben://file/{chapterId}`（整包字节，PDF 用）。
- **页码始终按阅读顺序递增**，日漫的左右排布只由 `spreadPages` 处理 —— 不要在 `next`/`prev` 里再按 `rtl` 反向，否则双页模式会卡在首页。
- **页数可能未知**：云端压缩包要下载整包后才知道页数，PDF 的页数由渲染进程 pdfjs 统计。
  `pageCount` 为 0 表示未知，此时不做页码上界钳位、不判定「已读完」；页数回填后主进程会广播 `chapter:pageCount` 通知界面刷新。
- **扫描是增量的**：按 size + mtime 跳过未变化章节的页数统计；`series_fts` 每次扫描重建（藏书量级下成本可忽略）。
- **消失的系列不硬删**：源目录不可用（移动硬盘未挂载、根目录改名）时，有阅读进度的系列只标记 `missing` 并保留进度，重新扫描到即恢复。

## 数据存放位置

Windows 下为 `%APPDATA%\一本 Yiben\`：

- `yiben.db` — SQLite（书库、系列、章节、进度、设置）
- `thumbs/series-<id>.webp` — 系列封面
- `thumbs/pages/<chapterId>/` — 页缩略图（上限 256MB，超出按最久未用回收）
- `cache/cloud189/` — 云端缓存（`index.json` 为 LRU 索引，容量上限见设置页）

删除书库会清掉其缓存产物；「移出书架」只是隐藏，不删进度。

## 开发调试钩子

主进程支持一组环境变量，便于无头验证与截图：

| 变量 | 作用 |
| --- | --- |
| `YIBEN_SCREENSHOT=<png路径>` | 启动后截图并退出 |
| `YIBEN_ROUTE=<hash路由>` | 截图前跳转，如 `library` 或 `reader/12` |
| `YIBEN_THEME=light` | 截图前切浅色主题 |
| `YIBEN_KEY` / `YIBEN_KEY_TIMES` | 截图前模拟按键 |
| `YIBEN_EVAL=<表达式>` | 在渲染进程求值并打印 |
| `YIBEN_A11Y=1` | 暴露无障碍树（供桌面自动化 / 读屏器） |
| `YIBEN_SELFTEST=<fixture目录>` | 跑一遍加库→扫描→读页→封面→进度自检 |

`scripts/` 下另有若干一次性排查脚本（天翼云盘审计、fixture 生成、图标/PDF 生成）。

## 天翼云盘的两个坑（已在代码中处理）

- 官方「家庭云」界面展示的内容实际在 `我的应用/家庭云` 子目录下，open API 的 `-11` 根目录只返回系统默认空文件夹，因此列目录时会自动下钻对齐官方视图（见 `cloud189/client.ts`）。
- 下载直链带 XML 实体转义（`&amp;`），不解码就去请求会因参数失效返回 403，必须解码后再 fetch。
