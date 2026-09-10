const { app } = require('electron')
const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')

app.whenReady().then(async () => {
  try {
    const { safeStorage } = require('electron')
    const dbPath = path.join(app.getPath('appData'), '一本 Yiben', 'yiben.db')
    const db = new Database(dbPath, { readonly: true })
    const row = db.prepare("SELECT value FROM settings WHERE key = 'cloud189-cred'").get()
    if (!row) { console.log('NO_CRED'); app.quit(); return }
    const cred = JSON.parse(row.value)
    const password = safeStorage.decryptString(Buffer.from(cred.enc, 'base64'))

    const { CloudClient } = require('cloud189-sdk')
    const client = new CloudClient({ username: cred.username, password })

    // 个人云根目录
    const personal = await client.getListFiles({ folderId: '-11', pageSize: 10, pageNum: 1, iconOption: 1, orderBy: 1, descending: false })
    const pao = personal.fileListAO
    console.log('[personal] count=', pao.count, 'folders=', (pao.folderList||[]).map(f=>f.name).slice(0,8))

    // 家庭列表
    const fams = await client.getFamilyList()
    const famArr = fams.familyInfoResp || []
    for (const f of famArr) {
      console.log('[family]', f.familyId, f.remarkName)
      try {
        const resp = await client.getListFiles({ folderId: '-11', pageSize: 10, pageNum: 1, iconOption: 1, orderBy: 1, descending: false }, String(f.familyId))
        const ao = resp.fileListAO
        if (!ao) { console.log('  [family-resp-keys]', Object.keys(resp).join(',')); 
          console.log('  [family-raw]', JSON.stringify(resp).slice(0, 500)); continue }
        console.log('  count=', ao.count, 'folders=', (ao.folderList||[]).map(f2=>f2.name).slice(0,8), 'files=', (ao.fileList||[]).map(f2=>f2.name).slice(0,8))
      } catch (e) { console.log('  [family-err]', e.message) }
    }
    console.log('DEBUG_DONE')
  } catch (e) {
    console.error('DEBUG_ERROR', e && e.message)
  } finally {
    app.quit()
  }
})
