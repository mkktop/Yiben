// 补充审计：家庭云「我的应用/家庭云」深一层 + 账号实际用量
const { app, safeStorage } = require('electron')
const Database = require('better-sqlite3')
const path = require('path')

app.setPath('userData', path.join(app.getPath('appData'), '一本 Yiben'))
const BASE = { pageSize: 60, pageNum: 1, iconOption: 1, orderBy: 1, descending: false }

async function listAll(client, folderId, familyId) {
  const out = []
  for (let pageNum = 1; pageNum <= 30; pageNum++) {
    const resp = await client.getListFiles({ ...BASE, folderId, pageNum }, familyId)
    const ao = resp.fileListAO
    for (const f of ao.folderList || []) out.push({ id: String(f.id), name: f.name, dir: true })
    for (const f of ao.fileList || []) out.push({ id: String(f.id), name: f.name, dir: false })
    if (out.length >= (ao.count || 0) || (!(ao.fileList || []).length && !(ao.folderList || []).length))
      break
  }
  return out
}

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
    const { CloudClient } = require('cloud189-sdk')
    const client = new CloudClient({ username: cred.username, password })

    const info = await client.getUserSizeInfo()
    console.log(
      '[audit2] 个人云容量: 总=%s 已用=%s',
      info.cloudCapacityInfo?.totalSize,
      info.cloudCapacityInfo?.usedSize
    )
    if (info.familyCapacityInfo)
      console.log('[audit2] 家庭容量信息:', JSON.stringify(info.familyCapacityInfo))

    const fams = await client.getFamilyList()
    for (const f of fams.familyInfoResp || []) {
      console.log(`\n===== 家庭「${f.remarkName}」 我的应用(-16) 深入 =====`)
      const apps = await listAll(client, '-16', String(f.familyId))
      const familyDir = apps.find((x) => x.dir && x.name === '家庭云')
      if (!familyDir) {
        console.log('  (无「家庭云」子文件夹)', apps.map((x) => x.name).join('|'))
        continue
      }
      const inner = await listAll(client, familyDir.id, String(f.familyId))
      console.log(`  家庭云(${familyDir.id}) 内: count=${inner.length}`)
      for (const e of inner)
        console.log(`    ${e.dir ? '[D]' : '[F]'} ${e.name} (${e.id})`)
      for (const e of inner.filter((x) => x.dir)) {
        const deeper = await listAll(client, e.id, String(f.familyId))
        console.log(
          `      -- ${e.name} 内: count=${deeper.length} ${deeper.map((x) => (x.dir ? '[D]' : '[F]') + x.name).slice(0, 10).join(' | ') || '(空)'}`
        )
      }
    }
    console.log('\nAUDIT2_DONE')
  } catch (e) {
    console.error('[audit2] ERROR', e && (e.stack || e.message))
  } finally {
    app.quit()
  }
})
