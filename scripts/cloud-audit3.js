// 实测家庭云文件下载直链：取第一章第一页的真实 fileId 调 getFileDownloadUrl
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

    // 找五等分的花嫁第一个 cfolder 章节的第一页（chapter 4 = 第1卷 散图）
    const page = db
      .prepare(
        `SELECT cp.file_id, cp.name, cp.size, c.id AS chapter_id, c.kind, c.series_id
         FROM chapter_pages cp JOIN chapters c ON c.id = cp.chapter_id
         WHERE c.kind = 'cfolder' AND c.series_id = 4
         ORDER BY c.id, cp.idx LIMIT 1`
      )
      .get()
    console.log('[audit3] 测试页:', JSON.stringify(page))
    const pdf = db
      .prepare(
        `SELECT id, cloud_file_id, size, kind FROM chapters WHERE kind = 'pdf' ORDER BY id LIMIT 1`
      )
      .get()
    console.log('[audit3] 测试PDF章:', JSON.stringify(pdf))

    const { CloudClient } = require('cloud189-sdk')
    const client = new CloudClient({ username: cred.username, password })
    await client.getUserSizeInfo()

    const FAM = '300000978229446'
    for (const [label, params] of [
      ['散图页+familyId', { fileId: page.file_id, familyId: FAM }],
      ['散图页无familyId', { fileId: page.file_id }],
      ['PDF文件+familyId', { fileId: pdf.cloud_file_id, familyId: FAM }]
    ]) {
      try {
        const r = await client.getFileDownloadUrl(params)
        console.log(
          `[audit3] ${label} OK:`,
          typeof r.fileDownloadUrl === 'string'
            ? r.fileDownloadUrl.slice(0, 90) + '…'
            : JSON.stringify(r).slice(0, 200)
        )
      } catch (e) {
        let body = ''
        try {
          body = e.response ? await e.response.text() : JSON.stringify(e).slice(0, 300)
        } catch {}
        console.log(`[audit3] ${label} FAIL: ${e.message} | body=${body.slice(0, 300)}`)
      }
    }
    console.log('AUDIT3_DONE')
  } catch (e) {
    console.error('[audit3] ERROR', e && (e.stack || e.message))
  } finally {
    app.quit()
  }
})
