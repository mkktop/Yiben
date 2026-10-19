# Electron 调试配方

> 外部 Electron 脚本解密 Yiben 存储的天翼凭证需先 setPath userData；YUDU_A11Y=1 可暴露 UI 无障碍树做自动化

两个 Yiben 调试配方（2026-09 实测有效）：

1. **解密存储的云盘凭证**：Electron safeStorage 在 Windows 上的密钥存在 `userData/Local State`（不再直接用 DPAPI），外部脚本必须先 `app.setPath('userData', path.join(appPath, '雨读 Yudu'))`（app ready 前），否则 `decryptString` 报 "Error while decrypting the ciphertext"。之后从 `yudu.db` 的 settings 表读 `cloud189-cred`（JSON `{username, enc}`，enc 为 base64）即可解密登录。现成脚本：`scripts/cloud-audit.js` / `cloud-audit2.js`（`npx electron scripts/cloud-audit.js`）。

2. **桌面自动化操作运行中的 App**：以 `YUDU_A11Y=1 pnpm dev` 启动（src/main/index.ts 在 whenReady 里据此设 `app.accessibilitySupportEnabled = true`，注意该 API 只能在 ready 之后调用，放模块顶层会炸掉主进程加载），computer-use 即可通过无障碍树读按钮/点击，全程不需要截图坐标。相关钩子还有 YUDU_SCREENSHOT/YUDU_ROUTE/YUDU_EVAL（见 [天翼家庭云根目录怪癖](cloud189-family-root-quirk.md)）。

3. **会话 token 文件也已加密**（2026-09-12 起）：`userData/cloud189-token.json` 不再是 SDK FileTokenStore 的明文 JSON，而是自定义 EncryptedTokenStore（extends cloud189-sdk 包根导出的 `Store` 抽象类，只需实现 async get/update）写的 `{accessToken, refreshToken?, expiresIn}`，值均为 safeStorage 加密后的 base64；**解密失败会原样返回字符串**（兼容旧明文文件，旧数据无需迁移）。检查/调试 token 直接复用第 1 条的 setPath + decryptString 配方。
