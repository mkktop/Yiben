// 深度审计天翼云盘：个人云 + 所有家庭云根目录 + 根目录下每个文件夹的内容
// 用法: npx electron scripts/cloud-audit.js
const { app, safeStorage } = require('electron')
const Database = require('better-sqlite3')
const path = require('path')

// safeStorage 的密钥存在 userData/Local State 里，必须先指向同一 userData 才能解密
app.setPath(
  'userData',
  path.join(app.getPath('appData'), '一本 Yiben')
)

const BASE = { pageSize: 60, pageNum: 1, iconOption: 1, orderBy: 1, descending: false }

async function listAll(client, folderId, familyId) {
  const out = []
  for (let pageNum = 1; pageNum <= 30; pageNum++) {
    const resp = await client.getListFiles({ ...BASE, folderId, pageNum }, familyId)
    const ao = resp.fileListAO
    if (!ao) throw new Error('no fileListAO: ' + JSON.stringify(resp).slice(0, 200))
    for (const f of ao.folderList || []) out.push({ id: String(f.id), name: f.name, dir: true })
    for (const f of ao.fileList || [])
      out.push({ id: String(f.id), name: f.name, dir: false, size: f.size })
    if (
      out.length >= (ao.count || 0) ||
      (!(ao.fileList || []).length && !(ao.folderList || []).length)
    )
      break
  }
  return out
}

app.whenReady().then(async () => {
  try {
    const dbPath = path.join(app.getPath('userData'), 'yiben.db')
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    const row = db.prepare("SELECT value FROM settings WHERE key = 'cloud189-cred'").get()
    if (!row) {
      console.log('[audit] NO_CRED')
      app.exit(1)
      return
    }
    const cred = JSON.parse(row.value)
    const password = safeStorage.decryptString(Buffer.from(cred.enc, 'base64')).toString('utf8')
    console.log('[audit] 凭证解密成功，账号:', cred.username)

    const { CloudClient } = require('cloud189-sdk')
    const client = new CloudClient({ username: cred.username, password })
    await client.getUserSizeInfo()
    console.log('[audit] 登录成功')

    console.log('\n===== 个人云 根目录 =====')
    const personal = await listAll(client, '-11', undefined)
    console.log(`count=${personal.length}`)
    for (const e of personal) console.log(`  ${e.dir ? '[D]' : '[F]'} ${e.name} (${e.id})`)
    for (const e of personal.filter((x) => x.dir)) {
      try {
        const sub = await listAll(client, e.id, undefined)
        const names = sub.map((x) => (x.dir ? '[D]' : '[F]') + x.name)
        console.log(
          `  -- ${e.name}(${e.id}) 内: count=${sub.length} ${names.slice(0, 15).join(' | ') || '(空)'}`
        )
      } catch (err) {
        console.log(`  -- ${e.name} 列目录失败:`, err.message)
      }
    }

    const fams = await client.getFamilyList()
    console.log('\n===== 家庭云列表 =====')
    for (const f of fams.familyInfoResp || [])
      console.log(`familyId=${f.familyId} remarkName=${f.remarkName}`)

    for (const f of fams.familyInfoResp || []) {
      console.log(`\n===== 家庭「${f.remarkName}」(${f.familyId}) 根目录 =====`)
      const root = await listAll(client, '-11', String(f.familyId))
      console.log(`count=${root.length}`)
      for (const e of root) console.log(`  ${e.dir ? '[D]' : '[F]'} ${e.name} (${e.id})`)
      for (const e of root.filter((x) => x.dir)) {
        try {
          const sub = await listAll(client, e.id, String(f.familyId))
          const names = sub.map((x) => (x.dir ? '[D]' : '[F]') + x.name)
          console.log(
            `  -- ${e.name}(${e.id}) 内: count=${sub.length} ${names.slice(0, 15).join(' | ') || '(空)'}`
          )
        } catch (err) {
          console.log(`  -- ${e.name} 列目录失败:`, err.message)
        }
      }
    }
    console.log('\nAUDIT_DONE')
  } catch (e) {
    console.error('[audit] ERROR', e && (e.stack || e.message))
  } finally {
    app.quit()
  }
})
