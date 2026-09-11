/**
 * 无窗口验证：FileTokenStore 会话持久化。
 * 第一阶段用密码登录并落盘 token；第二阶段只用 token（不给密码）恢复会话。
 * 用法：npx electron scripts/token-store-probe.js
 */
const { app, safeStorage } = require('electron')
const path = require('path')
const { CloudClient, FileTokenStore } = require('cloud189-sdk')

app.setPath('userData', path.join(process.env.APPDATA, '一本 Yiben'))

app.whenReady().then(async () => {
  const tokenPath = path.join(app.getPath('userData'), 'cloud189-token.json')
  const fs = require('fs')
  try {
    const Database = require('better-sqlite3')
    const db = new Database(path.join(app.getPath('userData'), 'yiben.db'), { readonly: true })
    const row = db.prepare("SELECT value FROM settings WHERE key = 'cloud189-cred'").get()
    db.close()
    if (!row) throw new Error('yiben.db 里没有 cloud189-cred')
    const cred = JSON.parse(row.value)
    const password = safeStorage.decryptString(Buffer.from(cred.enc, 'base64'))

    if (fs.existsSync(tokenPath)) {
      console.log('[probe] 阶段0：token 文件已存在（上次登录留下的）')
    }

    console.log('[probe] 阶段1：密码登录（写 token）…')
    const c1 = new CloudClient({ username: cred.username, password, token: new FileTokenStore(tokenPath) })
    await c1.getUserSizeInfo()
    console.log('[probe] 阶段1 成功，token 文件存在 =', fs.existsSync(tokenPath))

    console.log('[probe] 阶段2：只用 token 恢复会话（不给密码）…')
    const c2 = new CloudClient({ username: cred.username, token: new FileTokenStore(tokenPath) })
    await c2.getUserSizeInfo()
    console.log('[probe] 阶段2 成功：免密码恢复会话 ✓')
  } catch (e) {
    console.log('[probe] 失败:', String(e))
  } finally {
    app.exit(0)
  }
})
