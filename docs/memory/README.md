# 项目记忆

本目录沉淀开发过程中实测得到的项目知识：云盘接口怪癖、阅读器架构不变量、无头验证配方、发版约束等。
2026-10-19 从 AI 助手的项目记忆中整理入库，避免换机丢失；原始记录写于 2026-09 ~ 2026-10，代码变更后请以当前实现为准。

> 目录内的凭证解密与无头调试配方仅用于本机调试自己的数据；不要把任何真实凭证写进仓库。

## 索引

### 云盘与云端直读

- [天翼家庭云根目录怪癖](cloud189-family-root-quirk.md) — API `-11` 根只有默认空夹，真实内容在「我的应用/家庭云」
- [天翼下载直链实体转义](cloud189-download-url-entity-escape.md) — 直链含 `&amp;` 不解码 fetch 必 403；`familyId` 缺失 400；启动竞态需 `waitCloudReady`
- [天翼直链支持 Range 206](cloud189-range-206-supported.md) — 云端 zip 免整包直读的实测前提；remoteZip 仅在未缓存时启用
- [天翼按家庭容量接口](cloud189-family-capacity-endpoint.md) — `api.cloud.189.cn/open/.../getUserInfo.action?familyId`；探针脚本无窗口验证
- [云盘扫描进度事件契约](cloud-scan-progress-contract.md) — done 只由 rescan 发；首条进度先于联网；系列级计数 + 章节级标题

### 阅读器

- [B站漫画阅读器模式](bilibili-manga-reader-patterns.md) — 跨页手动重配对/RTL 提示/键盘图/无缝跨话/canvas 分段虚拟化等可借鉴模式
- [条漫跨话连续滚动](yiben-webtoon-cross-chapter.md) — 条带全局页号 + 软切换归属话；`data-page` 全局序而 store 页码局部；拼接触发 `nextStart - 2`

### 构建、发版与审查

- [雨读 Yudu 发版链](yiben-release-chain.md) — tag `v*` → CI 出 NSIS 包上 GitHub Release + R2 桶；`npmRebuild` 必须 `false`；R2 API 不支持 HEAD
- [代码审查报告状态](yiben-code-review-status.md) — 2026-09-14 与 2026-09-19 两轮审查问题均已修复，更旧报告勿照修
- [审查误报勘误](review-errata-2026-09-11.md) — 曾被误判为缺陷、实测确认无需修改的几处实现

### 验证与调试

- [无头验证配方](yiben-headless-verify-recipe.md) — 隔离 userData 跑 selftest；截图正斜杠；调试钩子 `is.dev` 门控；断言优先读 DB/vitest
- [Electron 调试配方](electron-safeStorage-decrypt-recipe.md) — 外部脚本解密凭证要先指 userData；`YUDU_A11Y=1` 暴露无障碍树
- [115 验证环境限制](yiben-115-verify-env-limits.md) — 开发机海外 IP 部分被 115 封；中国网络实机才能全链路验证

### 数据与扫描

- [scan_error 的 PDF 误报坑](yiben-scan-error-pdf-quirk.md) — PDF 恒报「暂不支持的格式」属能力边界；读 `scan_error` 的功能必须排除 `kind='pdf'`

### 项目边界

- [内容源边界](content-source-boundary.md) — 只做本地文件 + 用户自己的网盘，不内置在线书源
