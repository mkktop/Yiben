// 探测天翼云盘下载直链是否支持 HTTP Range（206）——决定能否做「Range 直读压缩包」
// 用法: npx electron scripts/range-probe.js
const { app, safeStorage } = require('electron')
const Database = require('better-sqlite3')
const path = require('path')

app.setPath('userData', path.join(app.getPath('appData'), '一本 Yiben'))

function decodeUrl(u) {
  return u.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
}

app.whenReady().then(async () => {
  try {
    const db = new Database(path.join(app.getPath('userData'), 'yiben.db'), {
      readonly: true,
      fileMustExist: true
    })
    const row = db.prepare("SELECT value FROM settings WHERE key = 'cloud189-cred'").get()
    if (!row) {
      console.log('NO_CRED')
      app.exit(1)
      return
    }
    const cred = JSON.parse(row.value)
    const password = safeStorage.decryptString(Buffer.from(cred.enc, 'base64')).toString('utf8')

    const { CloudClient } = require('cloud189-sdk')
    const client = new CloudClient({ username: cred.username, password })
    await client.getUserSizeInfo()
    console.log('[probe] 登录成功')

    // 压缩包章节优先；没有的话用任意云端文件测（同一套下载直链服务，Range 行为一致）
    let chapters = db
      .prepare(
        `SELECT c.id, c.title, c.kind, c.size, c.cloud_file_id, l.family_id
         FROM chapters c
         JOIN series s ON s.id = c.series_id
         JOIN libraries l ON l.id = s.library_id
         WHERE l.kind = 'cloud189' AND c.cloud_file_id IS NOT NULL AND c.kind != 'pdf'
         ORDER BY c.size ASC LIMIT 3`
      )
      .all()
    if (chapters.length === 0) {
      chapters = db
        .prepare(
          `SELECT cp.file_id AS cloud_file_id, cp.name AS title, cp.size, 'cfolder-page' AS kind, l.family_id
           FROM chapter_pages cp
           JOIN chapters c ON c.id = cp.chapter_id
           JOIN series s ON s.id = c.series_id
           JOIN libraries l ON l.id = s.library_id
           WHERE l.kind = 'cloud189' ORDER BY cp.size DESC LIMIT 3`
        )
        .all()
    }
    console.log(
      '[probe] 候选文件:',
      chapters.map((c) => `${c.title}(${c.size}B ${c.kind})`).join(' | ')
    )
    if (chapters.length === 0) {
      console.log('NO_CHAPTER')
      app.exit(1)
      return
    }

    for (const ch of chapters) {
      console.log(`\n===== ${ch.title} kind=${ch.kind} size=${ch.size} =====`)
      let url
      try {
        const resp = await client.getFileDownloadUrl({
          fileId: ch.cloud_file_id,
          familyId: ch.family_id || undefined
        })
        url = decodeUrl(resp.fileDownloadUrl)
      } catch (e) {
        console.log('  取直链失败:', e.message)
        continue
      }

      // 1) Range 头部小段
      try {
        const r = await fetch(url, { headers: { Range: 'bytes=0-1023' } })
        console.log(
          '  bytes=0-1023 →',
          r.status,
          'content-range:',
          r.headers.get('content-range'),
          'content-length:',
          r.headers.get('content-length'),
          'accept-ranges:',
          r.headers.get('accept-ranges')
        )
        if (r.status === 206) {
          const buf = Buffer.from(await r.arrayBuffer())
          console.log('  实收字节:', buf.length, '头部魔数:', buf.subarray(0, 4).toString('hex'))
        }
      } catch (e) {
        console.log('  Range 请求异常:', e.message)
      }

      // 2) 末尾 64 字节（EOCD 定位用）
      try {
        const start = Math.max(0, ch.size - 64)
        const r2 = await fetch(url, { headers: { Range: `bytes=${start}-` } })
        console.log(
          `  bytes=${start}- →`,
          r2.status,
          'content-range:',
          r2.headers.get('content-range')
        )
      } catch (e) {
        console.log('  尾部 Range 异常:', e.message)
      }

      // 3) 中段随机读
      try {
        const mid = Math.floor(ch.size / 2)
        const r3 = await fetch(url, { headers: { Range: `bytes=${mid}-${mid + 4095}` } })
        console.log(
          `  中段 bytes=${mid}-${mid + 4095} →`,
          r3.status,
          'content-range:',
          r3.headers.get('content-range')
        )
      } catch (e) {
        console.log('  中段 Range 异常:', e.message)
      }
      break // 一个文件足够判定
    }
    console.log('\nPROBE_DONE')
  } catch (e) {
    console.error('PROBE_ERROR', e && (e.stack || e.message))
  } finally {
    app.quit()
  }
})
