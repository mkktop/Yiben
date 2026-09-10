# 「一本 Yiben」— Electron 精美漫画阅读器实施方案（本地 + 天翼云盘）

## 一、产品定位

**漫画存天翼云盘 + 本地文件夹，统一进一个精美书架**。核心体验：云盘里的漫画像本地一样秒开翻页，收藏量大了也不占硬盘。

**集百家之所长**对照表：

| 功能 | 借鉴对象 |
|---|---|
| 「继续阅读」封面墙首页（On Deck）、流媒体式深色质感 | Kavita |
| 系列/章节两层模型、ComicInfo.xml、文件名智能解析 | Komga / YACReader |
| 单页 / 日漫 RTL 双页 / 条漫垂直连续、按系列覆盖阅读设置 | Mihon + OpenComic |
| 书签、缩略图跳转条、沉浸式自动隐藏 UI | OpenComic |
| 秒开体验（预加载 + 多级缓存） | HoneyView |
| 双主题 + 强调色系统 | Koodo Reader |

## 二、技术栈（均已核实维护状态）

- **框架**：Electron（最新稳定版）+ electron-vite 5 + TypeScript
- **UI**：React 18 + Tailwind + shadcn/ui + framer-motion + TanStack Virtual（万级封面墙虚拟滚动）；状态用 Zustand
- **数据**：better-sqlite3（含 FTS5 搜索）+ electron-store（设置）
- **格式**：ZIP/CBZ→node-stream-zip；RAR/CBR（含 RAR5）→node-unrar-js；7Z/CB7→打包 7zip-bin 兜底；PDF→pdfjs-dist；散图文件夹→目录驱动
- **图像**：sharp 缩略图（WebP 落盘 + 内存 LRU）
- **天翼云盘**：**cloud189-sdk 1.0.9**（Node/TS，MIT，2026-03 仍在发版）——账号密码 RSA 加密登录、`getListFiles(pageQuery, familyId)` 分页列目录（含**家庭云**）、`getFileDownloadUrl()` 取直链、容量查询、token 持久化。以 tickstep/cloudpan189-api（Go）作接口行为参考文档
- **下载**：undici 流式下载 + Range 断点续传；凭证用 electron safeStorage（DPAPI）加密存储
- **i18n**：i18next（zh-CN 默认）；**打包**：electron-builder（NSIS + portable）

## 三、架构设计

安全基线：contextIsolation 开、渲染进程零 Node 权限，全部 IO 在主进程。

```
渲染进程 (React 书架/阅读器)
   │  IPC: window.yiben 类型化 API
   │  图片: <img src="yiben://..."> 自定义协议（吃满 Chromium 缓存，翻页零拷贝）
───────── 主进程 ─────────
Scanner 扫描抽象 ── Lister 接口 ─┬─ LocalLister（chokidar 监视增量）
                               └─ Cloud189Lister（分页遍历个人云/家庭云，按 fileId+mtime 增量）
ArchiveDriver 统一接口 listPages()/readPage(i) ── Zip/Rar/SevenZip/Pdf/Folder 五实现
CloudCacheManager ── 下载队列 + 进度 + 断点续传 + 容量上限 LRU 淘汰 + 离线固定
SQLite（library/series/chapter/progress + FTS5；系列章节带 source_type/fileId/familyId 字段）
```

**云端读取策略**（关键设计）：
- 云上**散图文件夹**（推荐布局）：单图按需下载 + 向后预取 3 页，最省流量、接近秒开
- 云上**压缩包**：下载直链流式写入本地缓存 → 完成后走本地 ArchiveDriver（RAR 无法远程随机访问，整包缓存是通行做法）；下载中显示进度条
- 缓存目录 `userData/cache/cloud189`，上限可设（默认 20GB），LRU 自动淘汰；系列可"离线固定"批量下载
- 下载直链有时效 → 每次下载前实时获取

## 四、目录结构

```
D:\work\Yiben
├─ src/
│  ├─ main/           # db/ scanner/ archives/ cloud189/ cache/ thumbnail/ protocol/ window
│  ├─ preload/        # contextBridge 类型化 API
│  └─ renderer/       # routes: 首页(继续阅读)/书架/系列详情/阅读器/设置(云盘登录)
├─ resources/         # 图标
└─ electron.vite.config.ts / electron-builder.yml
```

## 五、MVP 功能清单

**书架**：本地 + 云盘统一封面墙；多库/多云盘目录；虚拟滚动；最近添加/继续阅读/未读筛选；FTS 搜索；标签作者筛选；系列详情页（元数据+章节+进度条）

**阅读器**（心脏，重点打磨）：单页 LTR / RTL 双页拼页（封面智能对齐）/ 条漫垂直连续；适宽/适高/原始/缩放/旋转；±3 页预加载；缩略图跳转条；沉浸模式（自动隐藏 UI）；完整快捷键（←→/空格/PgUp/Home/End/F/S/D/G）；页级进度实时保存

**首页**：继续阅读（On Deck）+ 最近添加 + 未读徽章

**元数据**：ComicInfo.xml + 文件名解析（卷/话/标题）+ 封面提取

**天翼云盘**：设置页登录（密码 + 扫码两种，SDK 支持扫码类型）、选择云盘目录（个人云/家庭云）、云端扫描入架、下载进度显示、缓存容量管理、离线固定、云盘剩余容量显示

**主题**：深色默认 + 浅色切换 + 强调色

## 六、实施里程碑

- **M0 脚手架**：electron-vite + React + shadcn 初始化、双主题 token、AppShell 布局、路由骨架 ✅ 空壳可启动可切主题
- **M1 本地库引擎**：扫描器 + SQLite + ArchiveDriver 五实现 + 缩略图管线 + yiben:// 协议。**第一天先打通 better-sqlite3/sharp 原生模块构建**（最大返工风险前置）✅ 指向真实文件夹能出正确的系列/章节/封面
- **M2 书架 UI**：封面墙、搜索筛选、详情页、继续阅读首页 ✅ 真实藏书浏览流畅
- **M3 阅读器**：三模式 + 进度 + 快捷键 + 预加载 ✅ CBZ/RAR/PDF/文件夹体验一致
- **M4 天翼云盘源**：cloud189-sdk 接入（登录/列目录/直链）、Cloud189Lister、CloudCacheManager、云盘设置页 ✅ 云盘漫画可浏览可阅读，断网可读已缓存章节
- **M5 打磨发布**：动效、i18n、设置页完善、electron-builder 打包 ✅ 双击安装即用

## 七、关键风险与对策

- **原生模块 ABI**（better-sqlite3/sharp）→ M1 首日验证，不行立即换替代方案
- **天翼登录风控**（新设备可能触发验证）→ SDK RSA 加密登录为主、扫码登录兜底；token 持久化减少重登
- **云盘接口非官方可能变动** → Source 层薄封装隔离，SDK 若断更可 vendor 进仓库修补，接口行为以 tickstep 项目为对照
- **云上大压缩包需整包下完才能看** → UI 明示进度；文档建议"按话分包/散图目录"的云盘存储布局
- **Windows 中文/长路径** → 统一 `\\?\` 前缀处理
- **万册性能** → 全程虚拟滚动 + 缩略图落盘

## 八、非目标（MVP 不做，backlog）

在线漫画源聚合、OPDS/自托管客户端、Bangumi 同步、上传备份到云盘、EPUB、放大镜/上色、NAS 服务模式、移动端。

---

项目名暂定「一本 Yiben」。按 M0→M5 顺序实施，每步可运行可验收，完成后即是可日常使用的 v0.1。