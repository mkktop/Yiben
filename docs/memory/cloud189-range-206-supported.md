# 天翼直链支持 Range 206

> 天翼云盘下载直链实测完整支持 HTTP Range（206/accept-ranges），Yiben 据此实现了云端 zip 免整包直读

天翼云盘下载直链（个人云与家庭云同一套 CDN）**完整支持 HTTP Range**：2026-09 用真实凭据探测（`scripts/range-probe.js`，复用 [Electron 调试配方](electron-safeStorage-decrypt-recipe.md) 的解密方式）确认 `accept-ranges: bytes`，头部/尾部/中段请求均返回 206 且 Content-Range 准确。

Yiben据此实现了 `src/main/archives/remoteZip.ts`（Range 直读 zip/CBZ：中央目录 2~3 个请求 + 按需取 entry，store/deflate/基本 zip64，403 换链重试），接入点在 `cloud189/ensure.ts` —— 仅当本地未缓存时启用，探测失败自动回退整包下载（`cloud189/remoteZipManager.ts` 按章节缓存实例）。直链有时效，长会话读页靠 refresh 闭包换新 URL。

注意：真实库里当时只有散图章节（cfolder），remoteZip 的在线链路尚未在真实云端 zip 上跑过，但解析器有本地 HTTP Range 服务器单测（`remoteZip.test.ts`）。
