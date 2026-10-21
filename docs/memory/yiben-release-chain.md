# 雨读 Yudu 发版链

> 雨读发版链：tag v* 触发 CI 出 NSIS 包上 GitHub Release + R2 桶 yudu（应用内更新走公开域 yudu-media.yeyushi.com）；npmRebuild 必须 false；publish 在 package.json#build

**品牌改名（2026-09-23，用户拍板「未正式发布、不留任何旧痕」）**：一本 Yiben → 雨读 Yudu，**全面改名、零兼容层**——appId `com.yudu.app`、productName `雨读 Yudu`、exe 名 `Yudu`、产物 `Yudu_*_setup.exe`、协议 `yudu://`、桥 `window.yudu`、env `YUDU_*`、DB `yudu.db`、导出标记 `'yudu'`。曾实现过 legacyData.ts 自动迁移 + appId 保留方案，后按用户要求全部删除（git 历史里留了实现可考）。**v0.3.0（2026-10-11）已按新名发布**，原基础设施待办全部落定：① R2 桶 `yudu` 已建，自定义域最终定为 **`yudu-media.yeyushi.com`**（用户 2026-10-11 拍板，不是早期计划的 yudu.kaikun.top——该域 NXDOMAIN；旧域 yiben.kaikun.top 仍活着但冻结在 v0.2.2，老客户端永远看不到新版本）；② GitHub 仓库**实际名就是 `mkktop/Yiben`**（`mkktop/Yudu` 404 无重定向；v0.3.0 里 GH_FEED 曾错指 Yudu，master 已改回 Yiben，v0.3.1 起生效）；③ 旧版本数据目录 `%APPDATA%\一本 Yiben`（yiben.db）不会自动迁移，需要手动重建书库。

雨读 Yudu 自 0.1.1（2026-09-11，commit 27a06a4）起的更新/发版方式，整体移植自作者的另一个 Electron 项目：

**发版流程**：改 `package.json` version → `RELEASE_NOTES.md` 顶部加 `## vX.Y.Z` 分节（Release 正文 = 该文件全量，客户端按版本切节）→ commit → `git tag vX.Y.Z && git push origin master --tags` → `.github/workflows/release.yml` 自动：tag/package.json 版本一致性校验 → typecheck+vitest 门禁 → `pnpm dist`（electron-vite build + electron-builder --win nsis --publish never）→ 上传 `dist/Yudu_*_setup.exe + latest.yml` 到 GitHub Release（tag 含 `-preview.` 标记预发布）→ pwsh 步骤用 Cloudflare REST（Invoke-RestMethod PUT `/accounts/{id}/r2/buckets/yiben/objects/{key}`）把同两件推到 R2 桶 `yiben`（2026-09-15 加）。

**更新渠道（v0.2.2 起 R2，v0.3.0 起换域）**：应用内检查走 R2——`build.publish` 为 `generic` + `url: https://yudu-media.yeyushi.com`（烤进 app-update.yml），配 `releaseInfo.releaseNotesFile: RELEASE_NOTES.md` 让 latest.yml 带 notes（cleanNotes 按 `## vX.Y.Z` 切节，纯 markdown 路径）。generic 渠道 latest.yml 的 `files[0].url` 只写**文件名 basename**，electron-updater 自动拼域名 → 桶根直挂同名文件即可。GitHub Release 保留为发布页镜像。CI 密钥在 repo secrets：`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`（具体值只存于仓库 secrets，勿写入文档）。v0.3.0 实测公开域 latest.yml 200（sha512/size/notes 全对）、exe HEAD 200。

**客户端**（仅打包版，dev 返回 status:'dev'）：设置页「关于与更新」手动检查→下载（进度条）→立即重启（quitAndInstall 静默）；启动自动检查由 config 键 `autoCheckUpdate` 控制（默认开）；侧边栏版本号动态显示、有更新时高亮。主进程 `src/main/updater.ts`，纯函数（notes HTML 清洗/semver 比较）在 `src/main/updateNotes.ts`（有单测）。

**关键坑（实测）**：
- `build.npmRebuild: false` 必须保留——better-sqlite3 v13/sharp 都是 N-API 预编译（prebuildify，无需编译），而 electron-builder 默认的 node-gyp 9.4.1 在 Python 3.12+（无 distutils）必挂。
- 检查 asar 内容时 `asar list` 在 Windows 输出**反斜杠**路径，用正斜杠 grep 会误报“没进包”。
- 下载源配置不在代码里：electron-builder 把 package.json 的 `build.publish` 烤进 `resources/app-update.yml`。
- **远端**：`github.com/mkktop/Yiben`（规范名，push + tag 触发 CI 正常；`mkktop/Yudu` 不存在）。写 secrets 用 REST API + `git credential fill` 取 GCM 存的 GitHub token，或 node fetch + `libsodium-wrappers` 的 `crypto_box_seal` 密封后 PUT（凭证查询管道里别回显 password）。
- 差分下载已禁用（disableDifferentialDownload），CI 不上传 blockmap 是有意的。
- **R2 REST API 对象接口不支持 HEAD（405）**：上传后核验要走公开自定义域 HEAD（`https://yudu-media.yeyushi.com/<key>`），别对 `api.cloudflare.com/.../objects/<key>` 发 HEAD——v0.3.0 的 tag run 就是挂在这步（PUT 其实已成功，渠道实际是通的），修复在 master、v0.3.0 的 run 永远显红属已知，勿重打 tag。
- **GitHub Windows runner 虚拟屏工作区只有 1024×720**：Electron 窗口被钳制到工作区，`windowBounds` 写 1400×900 实得 1024×720。依赖 ≥1280 宽窗口的 DOM 检查（series-layout.eval.js 宽窗口布局）须按 `screen.availWidth < 1296` 显式跳过（SERIES_LAYOUT_SKIPPED 日志），本地大屏照常执行。
- **本机 gh CLI 现在可用**（2026-10-11 全程实测 run list/view/watch/api 正常），旧结论「gh 是坏的 npm 同名包」已过时；CI 状态/重跑直接 gh 即可。
- **系统文件关联（cbz/cbr/cb7/cbt/pdf）也只配在 package.json#build** 的 `win.fileAssociations`（带 build/icon.ico）与 `mac.fileAssociations`（role: Viewer，2026-09-12 加）。`electron-builder.yml` 已删除：它存在时会遮蔽 package.json 的 build 配置（dist/ 里 v0.1.0 默认命名 vs v0.1.1 `Yudu_*_setup.exe` 两套产物即为实证），恢复它会让 CI 上传的 `Yudu_*_setup.exe` glob 失配。
- **开发机网络**：Clash 代理常不在运行（git/npm/系统代理都指 127.0.0.1:7897）；curl（Git Bash 与系统 curl.exe 都）被防火墙按程序拦截、沙箱更是全程断网——能网的组合是 Bash 工具 + dangerouslyDisableSandbox + PowerShell/Node（curl 换 Invoke-RestMethod 或 node fetch）。

**安装包瘦身（2026-10-21，v0.3.2）**：win-unpacked 540MB→354MB，手段与不变量——①**依赖分类是硬边界**：electron-builder 只收集 `dependencies`，主进程运行时 require 的包（sharp/better-sqlite3/7zip-bin/node-unrar-js/node-stream-zip/chokidar/cloud189-sdk/electron-updater/fast-xml-parser）留 dependencies（externalizeDepsPlugin 会 externalize 它们进 node_modules）；**纯渲染层包（react 全家/zustand/lucide-react/pdfjs-dist/@tanstack/react-virtual/clsx/tailwind-merge）必须在 devDependencies**——vite 已把它们 tree-shake 进 out/，放 dependencies 会整包混入 asar（v0.3.1 的 asar 里因此躺着 165MB node_modules，其中 pdfjs-dist 32.8MB + lucide 23.6MB + @napi-rs/canvas-win32-x64-msvc 36.7MB 纯死重——后者是 pdfjs-dist 的 optionalDependency，Node canvas 后端，Electron 永不加载）。build.files 的负模式是分类回退的兜底。②平台裁剪：better-sqlite3 只留 `prebuilds/win32-x64.node`（binding.js 按平台拼路径），排 `deps/`+`src/`（npmRebuild:false 永不编译）；7zip-bin 排 mac/linux。③`electronLanguages: ["zh-CN","en-US"]`（原 55 个 locale 49MB）。④`compression: "maximum"`。**本地 Windows 打 NSIS 的死循环坑**：非管理员无符号链接权限，winCodeSign 缓存解压必失败（darwin 符号链接 libcrypto/libssl.dylib），且每次重试解析出**新的哈希目录**补丁追不完——本地只能验证到 win-unpacked，NSIS 出包交给 CI（runner 有权限）；本机 electron-builder 需 `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`，Electron 本体下载需 `ELECTRON_MIRROR`（同理直连 GitHub 必挂）。

未移植（super_video 有、Yiben 暂缓）：稳定/预览通道选择器（仅 CI 侧支持 -preview. tag）。

相关：[无头验证配方](yiben-headless-verify-recipe.md)
