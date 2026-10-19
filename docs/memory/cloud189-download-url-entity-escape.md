# 天翼下载直链实体转义

> 天翼云盘 getFileDownloadUrl 返回的直链含 XML 实体转义（&amp;），不解码直接 fetch 会 403

天翼云盘 `getFileDownloadUrl`（个人与家庭端点皆然）返回的 `fileDownloadUrl` 里的 `&` 是 XML 实体 `&amp;`，SDK 原样返回不做解码。直接 `fetch(url)` 会带着废参数请求 → **HTTP 403**（响应是 text/xml）。必须先 `replace(/&amp;/g,'&')`（顺带 &lt;/&gt;/&quot;）。2026-09-10 实测：同一 URL 原样 403、解码后 200 且字节与文件大小一致。

**Why:** 这个 403 与"权限/风控"的表象一模一样，极易误判成账号问题；实际只是实体转义。云盘阅读"页面全挂"的排查应先想到它。

**How to apply:** `src/main/cloud189/client.ts` 的 `cloudDownloadUrl` 已内置解码。另外两个相关事实：① 家庭云文件调下载/列表接口必须带 familyId，否则个人端点返回 400（见 [天翼家庭云根目录怪癖](cloud189-family-root-quirk.md)）；② 启动时 safeStorage 会话恢复是异步的，协议层（封面/页面）需 `waitCloudReady()` 等待，否则"天翼云盘未登录"。验证脚本：`npx electron scripts/cloud-audit4.js`。
