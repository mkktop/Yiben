# 天翼家庭云根目录怪癖

> 天翼云盘 open API 家庭云根目录 -11 只返回默认空夹，真实内容在「我的应用/家庭云」子文件夹

天翼云盘 open API（cloud189-sdk `getListFiles({folderId:'-11'}, familyId)`）的家庭云根目录只会返回 6 个系统默认空文件夹（同步盘/我的图片/我的音乐/我的视频/我的文档/我的应用），而官方 App「家庭云」界面实际展示的内容存放在 `我的应用(-16)/家庭云` 子文件夹里（2026-09 实测：该账号的家庭云内容都在那里）。

**Why:** 用户曾以为家庭云"看不到东西"是 bug，实际是 API 根目录与官方视图不一致；两个空间默认夹名字完全一样，极易误判"显示的是个人云"。

**How to apply:** `src/main/cloud189/client.ts` 的 `cloudListAll` 已实现：familyId 存在且 folderId='-11' 时自动下钻 `-16` 里名为「家庭云」的子文件夹。家庭容量用 `getUserSizeInfo().familyCapacityInfo`（totalSize/freeSize）。复检脚本：`npx electron scripts/cloud-audit.js`（需先 [Electron 调试配方](electron-safeStorage-decrypt-recipe.md)）。
