import { app, safeStorage } from 'electron'
import { CloudClient, FileTokenStore } from 'cloud189-sdk'
import { rm } from 'fs/promises'
import { join } from 'path'
import { getSetting, setSetting } from '../settings'
import { broadcast } from '../events'

let client: CloudClient | null = null
let currentUsername = ''

/** 会话 token 落盘文件：accessToken（约 7 天）→ refreshToken 优先复用，都失效才密码登录 */
function tokenFile(): string {
  return join(app.getPath('userData'), 'cloud189-token.json')
}

// ---------- 风控/会话异常识别 ----------

/** 同类型告警 60 秒内只广播一次，避免连环失败刷屏 */
const noticedAt = new Map<string, number>()

/**
 * 识别云端报错里的「会话失效 / 触发限流」并广播给 UI。
 * 覆盖在 client.ts 各出口调用，调用方照常拿到原始异常。
 * 会话失效时顺带清掉内存会话，让 cloudStatus 如实反映「未连接」。
 */
export function noteCloudError(err: unknown): 'session' | 'ratelimit' | null {
  const msg = err instanceof Error ? err.message : String(err)
  const kind = /InvalidSessionKey|InvalidAccessToken|SessionUserNotExists|InvalidSSO|登录已失效|没有登录/i.test(
    msg
  )
    ? 'session'
    : /RatesExceed|TooManyRequests|HTTP 429|访问过于频繁|请求频繁/i.test(msg)
      ? 'ratelimit'
      : null
  if (!kind) return null
  const last = noticedAt.get(kind) ?? 0
  if (Date.now() - last >= 60_000) {
    noticedAt.set(kind, Date.now())
    broadcast('cloud:notice', {
      kind,
      message:
        kind === 'session'
          ? '天翼云盘登录已失效，请到「网盘」页重新连接'
          : '天翼云盘请求过于频繁被限流，请稍后再试'
    })
  }
  if (kind === 'session') client = null
  return kind
}

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

/** 账号密码登录；会话 token 落盘复用，之后启动无需再走密码登录（降低风控风险） */
export async function cloudLogin(username: string, password: string): Promise<void> {
  const c = new CloudClient({ username, password, token: new FileTokenStore(tokenFile()) })
  // 任一 API 调用会触发 SDK 自动登录（优先用持久化 token），失败则抛错
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
  // 会话 token 一并清掉，避免断开后仍用旧会话复活
  void rm(tokenFile(), { force: true }).catch(() => {})
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

/** 列出云盘目录（自动翻页）；出口统一做风控识别 */
export async function cloudListAll(folderId: string, familyId?: string): Promise<CloudEntry[]> {
  try {
    return await listAllInner(folderId, familyId)
  } catch (err) {
    noteCloudError(err)
    throw err
  }
}

async function listAllInner(folderId: string, familyId?: string): Promise<CloudEntry[]> {
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
  try {
    return await capacityInner(familyId)
  } catch (err) {
    noteCloudError(err)
    throw err
  }
}

async function capacityInner(familyId?: string): Promise<{ total: number; free: number }> {
  if (familyId) {
    // 官方 H5 家庭页同款接口：按 familyId 返回该家庭的真实配额（会员家庭可远大于
    // getUserSizeInfo 的账号级 familyCapacityInfo，那只是默认家庭的 30G 口径）。
    // H5 走 api.cloud.189.cn + AccessToken 签名，SDK 钩子对该域名的请求自动处理。
    const resp = (await requireClient().request
      .get(`https://api.cloud.189.cn/open/family/file/getUserInfo.action?familyId=${familyId}`)
      .json()) as {
      res_code?: string | number
      capacity?: number | string
      available?: number | string
    }
    if (String(resp.res_code ?? '0') === '0') {
      const total = Number(resp.capacity ?? 0)
      return { total, free: Number(resp.available ?? 0) }
    }
    return { total: 0, free: 0 }
  }
  const info = await requireClient().getUserSizeInfo()
  const personal = info.cloudCapacityInfo
  return {
    total: Number(personal?.totalSize ?? 0),
    free: Number(personal?.totalSize ?? 0) - Number(personal?.usedSize ?? 0)
  }
}

export async function cloudFamilies(): Promise<Array<{ id: string; name: string }>> {
  try {
    const resp = await requireClient().getFamilyList()
    return (resp.familyInfoResp ?? []).map((f) => ({
      id: String(f.familyId),
      name: f.remarkName
    }))
  } catch (err) {
    noteCloudError(err)
    throw err
  }
}

/** 获取下载直链（有时效，用前即取）。
 *  天翼返回的 URL 带 XML 实体转义（&amp;），必须先解码，否则请求参数全失效返回 403 */
export async function cloudDownloadUrl(fileId: string, familyId?: string): Promise<string> {
  try {
    const resp = await requireClient().getFileDownloadUrl({ fileId, familyId })
    return resp.fileDownloadUrl
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
  } catch (err) {
    noteCloudError(err)
    throw err
  }
}

export function cloudCacheDir(): string {
  return app.getPath('userData') + '/cache/cloud189'
}
