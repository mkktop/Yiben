/**
 * 无窗口探测脚本：验证按 familyId 取家庭真实容量的端点。
 * 用 Yiben 的 userData 解密存储的凭据登录，调用
 * api.cloud.189.cn/open/family/file/getUserInfo.action，打印结果后退出。
 * 用法：npx electron scripts/family-cap-probe.js <familyId> [familyId2 ...]
 */
const { app, safeStorage } = require('electron')
const path = require('path')
const { CloudClient } = require('cloud189-sdk')

app.setPath('userData', path.join(process.env.APPDATA, '一本 Yiben'))

const familyIds = process.argv.filter((a) => /^\d+$/.test(a))

app.whenReady().then(async () => {
  try {
    const fs = require('fs')
    // 设置存在 SQLite（settings 表），凭据字段 cloud189-cred
    const Database = require('better-sqlite3')
    const db = new Database(path.join(app.getPath('userData'), 'yiben.db'), { readonly: true })
    const row = db.prepare("SELECT value FROM settings WHERE key = 'cloud189-cred'").get()
    db.close()
    if (!row) throw new Error('yiben.db 里没有 cloud189-cred')
    const cred = JSON.parse(row.value)
    if (!cred) throw new Error('cloud189-cred 解析失败')
    const password = safeStorage.decryptString(Buffer.from(cred.enc, 'base64'))

    const c = new CloudClient({ username: cred.username, password })
    await c.getUserSizeInfo() // 触发登录
    console.log('[probe] logged in as', cred.username)

    for (const familyId of familyIds) {
      try {
        const resp = await c.request
          .get(`https://api.cloud.189.cn/open/family/file/getUserInfo.action?familyId=${familyId}`)
          .json()
        const r = resp
        const fmt = (n) => `${(Number(n) / 1024 ** 3).toFixed(2)} GB`
        console.log(`[probe] family ${familyId}:`, JSON.stringify(r))
        if (r && Number(r.capacity) > 0) {
          console.log(
            `[probe]   -> 总 ${fmt(r.capacity)} / 可用 ${fmt(r.available)} / 已用 ${fmt(
              Number(r.capacity) - Number(r.available)
            )}`
          )
        }
      } catch (e) {
        console.log(`[probe] family ${familyId} failed:`, String(e))
      }
    }
  } catch (e) {
    console.log('[probe] error:', String(e))
  } finally {
    app.exit(0)
  }
})
