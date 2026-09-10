import { app, safeStorage } from 'electron'
import { CloudClient } from 'cloud189-sdk'
import { getSetting, setSetting } from '../settings'

let client: CloudClient | null = null
let currentUsername = ''

// 启动时会话恢复是异步的：协议层（封面/页面）可能先到，等登录完成再继续
let readyWaiters: Array<() => void> = []

function notifyReady(): void {
  const waiters = readyWaiters
  readyWaiters = []
  for (const w of waiters) w()
}

/** 等待云盘会话可用（登录/恢复完成）；超时返回 false */
export function waitCloudReady(timeoutMs = 20000): Promise<boolean> {
  if (client) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(client !== null), timeoutMs)
    readyWaiters.push(() => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

interface StoredCred {
  username: string
  /** safeStorage 加密后的 base64 */
  enc: string
}

const CRED_KEY = 'cloud189-cred'

export function cloudStatus(): { loggedIn: boolean; username: string } {
  return { loggedIn: client !== null, username: currentUsername }
}

/** 账号密码登录；成功后凭据经 safeStorage 加密落盘，下次启动自动恢复 */
export async function cloudLogin(username: string, password: string): Promise<void> {
  const c = new CloudClient({ username, password })
  // 任一 API 调用会触发 SDK 自动登录，失败则抛错
  await c.getUserSizeInfo()
  client = c
  currentUsername = username
  notifyReady()
  if (safeStorage.isEncryptionAvailable()) {
    const enc = safeStorage.encryptString(password).toString('base64')
    setSetting<StoredCred>(CRED_KEY, { username, enc })
  }
}

export async function cloudRestore(): Promise<void> {
  if (client) return
  const cred = getSetting<StoredCred | null>(CRED_KEY, null)
  if (!cred || !safeStorage.isEncryptionAvailable()) return
  try {
    const password = safeStorage.decryptString(Buffer.from(cred.enc, 'base64'))
    await cloudLogin(cred.username, password)
  } catch (err) {
    console.warn('[cloud189] 会话恢复失败:', err instanceof Error ? err.message : err)
  }
}

export function cloudLogout(): void {
  client = null
  currentUsername = ''
  setSetting<StoredCred | null>(CRED_KEY, null)
}

export function requireClient(): CloudClient {
  if (!client) throw new Error('天翼云盘未登录')
  return client
}

export interface CloudEntry {
  id: string
  name: string
  size: number
  isDir: boolean
}

/** 列出云盘目录（自动翻页） */
export async function cloudListAll(folderId: string, familyId?: string): Promise<CloudEntry[]> {
  const c = requireClient()
  let rootId = folderId
  // 天翼官方「家庭云」界面展示的内容实际存放在 我的应用/家庭云 子文件夹下，
  // open API 的 -11 根目录只会返回 6 个系统默认空文件夹 —— 这里自动下钻对齐官方视图
  if (familyId && folderId === '-11') {
    try {
      const apps = await cloudListPage(c, '-16', familyId)
      const famDir = apps.find((e) => e.isDir && e.name === '家庭云')
      if (famDir) rootId = famDir.id
    } catch {
      // 找不到该子文件夹则按原始根目录展示
    }
  }
  return cloudListPage(c, rootId, familyId)
}

async function cloudListPage(
  c: CloudClient,
  folderId: string,
  familyId?: string
): Promise<CloudEntry[]> {
  const out: CloudEntry[] = []
  const pageSize = 200
  for (let pageNum = 1; ; pageNum++) {
    const resp = await c.getListFiles(
      { folderId, pageSize, pageNum, iconOption: 1, orderBy: 1, descending: false },
      familyId
    )
    const ao = resp.fileListAO
    for (const f of ao.folderList ?? []) out.push({ id: f.id, name: f.name, size: 0, isDir: true })
    for (const f of ao.fileList ?? [])
      out.push({ id: f.id, name: f.name, size: f.size ?? 0, isDir: false })
    if (out.length >= (ao.count ?? 0) || (ao.fileList.length === 0 && ao.folderList.length === 0))
      break
  }
  return out
}

export async function cloudCapacity(familyId?: string): Promise<{ total: number; free: number }> {
  const info = await requireClient().getUserSizeInfo()
  if (familyId) {
    const fam = info.familyCapacityInfo as
      | { totalSize?: number | string; freeSize?: number | string }
      | undefined
    const total = Number(fam?.totalSize ?? 0)
    if (total > 0) return { total, free: Number(fam?.freeSize ?? 0) }
  }
  const personal = info.cloudCapacityInfo
  return {
    total: Number(personal?.totalSize ?? 0),
    free: Number(personal?.totalSize ?? 0) - Number(personal?.usedSize ?? 0)
  }
}

export async function cloudFamilies(): Promise<Array<{ id: string; name: string }>> {
  const resp = await requireClient().getFamilyList()
  return (resp.familyInfoResp ?? []).map((f) => ({
    id: String(f.familyId),
    name: f.remarkName
  }))
}

/** 获取下载直链（有时效，用前即取）。
 *  天翼返回的 URL 带 XML 实体转义（&amp;），必须先解码，否则请求参数全失效返回 403 */
export async function cloudDownloadUrl(fileId: string, familyId?: string): Promise<string> {
  const resp = await requireClient().getFileDownloadUrl({ fileId, familyId })
  return resp.fileDownloadUrl
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
}

export function cloudCacheDir(): string {
  return app.getPath('userData') + '/cache/cloud189'
}
