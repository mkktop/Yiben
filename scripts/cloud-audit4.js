// 验证下载直链 &amp; 转义问题：同一 URL 原样 fetch vs 反转义后 fetch
const { app, safeStorage } = require('electron')
const Database = require('better-sqlite3')
const path = require('path')

app.setPath('userData', path.join(app.getPath('appData'), '一本 Yiben'))

app.whenReady().then(async () => {
  try {
    const db = new Database(path.join(app.getPath('userData'), 'yiben.db'), {
      readonly: true,
      fileMustExist: true
    })
    const cred = JSON.parse(
      db.prepare("SELECT value FROM settings WHERE key = 'cloud189-cred'").get().value
    )
    const password = safeStorage.decryptString(Buffer.from(cred.enc, 'base64')).toString('utf8')

    const page = db
      .prepare(
        `SELECT cp.file_id FROM chapter_pages cp JOIN chapters c ON c.id = cp.chapter_id
         WHERE c.kind = 'cfolder' ORDER BY c.id, cp.idx LIMIT 1`
      )
      .get()

    const { CloudClient } = require('cloud189-sdk')
    const client = new CloudClient({ username: cred.username, password })
    await client.getUserSizeInfo()

    const FAM = '300000978229446'
    const r = await client.getFileDownloadUrl({ fileId: page.file_id, familyId: FAM })
    const raw = r.fileDownloadUrl
    console.log('[audit4] 原始URL:', raw)
    const decoded = raw
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
    console.log('[audit4] 解码URL:', decoded)

    for (const [label, url] of [['原样', raw], ['解码', decoded]]) {
      try {
        const resp = await fetch(url, { redirect: 'follow' })
        const buf = resp.ok ? Buffer.from(await resp.arrayBuffer()) : null
        console.log(
          `[audit4] ${label}: HTTP ${resp.status} type=${resp.headers.get('content-type')}`,
          buf ? `bytes=${buf.length} head=${buf.slice(0, 8).toString('hex')}` : ''
        )
      } catch (e) {
        console.log(`[audit4] ${label}: 异常 ${e.message}`)
      }
    }
    console.log('AUDIT4_DONE')
  } catch (e) {
    console.error('[audit4] ERROR', e && (e.stack || e.message))
  } finally {
    app.quit()
  }
})
