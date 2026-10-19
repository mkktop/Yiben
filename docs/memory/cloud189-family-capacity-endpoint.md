# 天翼按家庭容量接口

> 天翼按 familyId 的家庭真实容量接口及无窗口验证脚本配方

天翼云盘 `getUserSizeInfo` 的 `familyCapacityInfo` 只是账号级默认口径（自建家庭 30G），加入的会员家庭（如 2TB 套餐）会显示错误容量。

按家庭的真实容量要用官方 H5 家庭页同款接口（从 h5.cloud.189.cn 的 main.js 里逆向确认）：
`GET https://api.cloud.189.cn/open/family/file/getUserInfo.action?familyId=X` → `{capacity, available}`（字节）。
关键坑：域名必须是 **api.cloud.189.cn**（SDK 钩子自动加 Accesstoken 头签名）；用 cloud.189.cn 会走 appKey+sessionKey 分支返回 400。

**Why:** 云盘页按空间显示容量时，账号级接口对多家庭/会员家庭全是错值。

**How to apply:** 主进程实现见 src/main/cloud189/client.ts 的 cloudCapacity(familyId)。无 UI 验证用 `npx electron scripts/family-cap-probe.js <familyId>`：app.setPath 指向「雨读 Yudu」userData → better-sqlite3 只读 yudu.db 的 settings 表取 cloud189-cred（safeStorage 解密）→ CloudClient 登录后直连端点，全程无窗口不抢焦点。相关：[天翼家庭云根目录怪癖](cloud189-family-root-quirk.md)、[Electron 调试配方](electron-safeStorage-decrypt-recipe.md)。
