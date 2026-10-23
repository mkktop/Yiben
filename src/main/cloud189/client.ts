import { app, safeStorage } from 'electron'
import { CloudClient, QRCodeStatus, Store } from 'cloud189-sdk'
import { readFile, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { getSetting, setSetting } from '../settings'
import { broadcast } from '../events'
import { decryptSecret, encryptSecret } from '../util/secret'
import { MinIntervalChain } from '../util/apiGate'

let client: CloudClient | null = null
let currentUsername = ''

/**
 * 目录列举 API 的最小间隔串行队列：天翼没有像 115 那样明确的限流口径，
 * 但扫描层并发下钻 + 翻页列举会在大库瞬间打出几十个 getListFiles——
 * 正是 RatesExceed 风控的触发形态。下载直链/容量查询是用户节奏的单发调用，不过闸。
 */
const listGate = new MinIntervalChain(300)

/** 会话 token 落盘文件：accessToken（约 7 天）→ refreshToken 优先复用，都失效才密码登录 */
function tokenFile(): string {
  return join(app.getPath('userData'), 'cloud189-token.json')
}

interface TokenRecord {
  /** safeStorage 加密后的 base64（isEncryptionAvailable 为 false 时退回明文） */
  accessToken: string
  refreshToken?: string
  expiresIn?: number
}

/**
 * 自定义 TokenStore：token 与密码一样走 safeStorage 加密后落盘。
 * SDK 自带的 FileTokenStore 是明文 JSON，本机任意程序都能读走 7 天有效期的会话。
 * 旧版明文 token 文件解析不出时按无会话处理，走存储的加密凭据自动重登一次。
 */
class EncryptedTokenStore extends Store {
  async get(): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    try {
      const rec = JSON.parse(await readFile(tokenFile(), 'utf-8')) as TokenRecord
      return {
        accessToken: decryptSecret(rec.accessToken),
        refreshToken: decryptSecret(rec.refreshToken ?? ''),
        expiresIn: rec.expiresIn ?? 0
      }
    } catch {
      return { accessToken: '', refreshToken: '', expiresIn: 0 }
    }
  }

  async update(token: {
    accessToken: string
    refreshToken?: string
    expiresIn?: number
  }): Promise<void> {
    const rec: TokenRecord = {
      accessToken: encryptSecret(token.accessToken),
      refreshToken: token.refreshToken ? encryptSecret(token.refreshToken) : undefined,
      expiresIn: token.expiresIn
    }
    // tmp + rename 原子写（与 cache.ts 的索引落盘一致）：
    // 写一半崩溃会丢整个会话文件，扫码与密码两条链并发写也可能交错
    const file = tokenFile()
    const tmp = `${file}.tmp`
    await writeFile(tmp, JSON.stringify(rec), 'utf-8')
    await rename(tmp, file)
  }
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
      provider: 'cloud189',
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
  /** 登录名 / 扫码登录时为账号昵称 */
  username: string
  /** safeStorage 加密后的 base64（扫码登录没有密码，无此字段） */
  enc?: string
}

const CRED_KEY = 'cloud189-cred'

export function cloudStatus(): { loggedIn: boolean; username: string } {
  return { loggedIn: client !== null, username: currentUsername }
}

/** 账号密码登录；会话 token 加密落盘复用，之后启动无需再走密码登录（降低风控风险） */
export async function cloudLogin(username: string, password: string): Promise<void> {
  const c = new CloudClient({ username, password, token: new EncryptedTokenStore() })
  // 任一 API 调用会触发 SDK 自动登录（优先用持久化 token），失败则抛错
  await c.getUserSizeInfo()
  client = c
  currentUsername = username
  notifyReady()
  if (safeStorage.isEncryptionAvailable()) {
    const enc = safeStorage.encryptString(password).toString('base64')
    setSetting<StoredCred>(CRED_KEY, { username, enc })
  } else {
    // 降级时不落密码（settings 表会是明文）：会话仍可经加密 token 恢复，
    // token 也失效时需要用户重新登录，而不是把明文密码留在磁盘上
    console.warn('[cloud189] safeStorage 不可用，本次登录不持久化密码（重启后按 token 恢复）')
  }
}

export async function cloudRestore(): Promise<void> {
  if (client) return
  const cred = getSetting<StoredCred | null>(CRED_KEY, null)
  // 优先走存了密码的恢复（密码登录用户）
  if (cred?.enc && safeStorage.isEncryptionAvailable()) {
    try {
      const password = safeStorage.decryptString(Buffer.from(cred.enc, 'base64'))
      await cloudLogin(cred.username, password)
      return
    } catch (err) {
      console.warn('[cloud189] 密码恢复失败:', err instanceof Error ? err.message : err)
    }
  }
  // 扫码登录用户没有存密码：仅凭加密落盘的 token 恢复会话（token 失效则保持未登录）
  try {
    const store = new EncryptedTokenStore()
    const c = new CloudClient({ token: store })
    await c.getUserSizeInfo()
    client = c
    currentUsername = cred?.username ?? ''
    notifyReady()
  } catch (err) {
    console.warn('[cloud189] token 恢复失败:', err instanceof Error ? err.message : err)
  }
}

export function cloudLogout(): void {
  client = null
  currentUsername = ''
  qrSession = null
  setSetting<StoredCred | null>(CRED_KEY, null)
  // 会话 token 一并清掉，避免断开后仍用旧会话复活
  void rm(tokenFile(), { force: true }).catch(() => {})
}

// ---------- 扫码登录 ----------
// 走 SDK 内置的 logbox 扫码链路（getUUID → qrcodeLoginState 轮询 → getSessionForPC 换会话），
// 拿到的 accessToken/refreshToken 写进与密码登录相同的加密 token 存储，会话复用完全一致。

interface QrLoginSession {
  client: CloudClient
  store: EncryptedTokenStore
  qrData: Awaited<ReturnType<CloudClient['authClient']['getQRCode']>>
}

let qrSession: QrLoginSession | null = null
let qrPollBusy = false

export interface CloudQrPoll {
  /** waiting=未扫码 scanned=已扫码待确认 done=登录成功 expired=二维码过期 */
  state: 'waiting' | 'scanned' | 'done' | 'expired'
  username?: string
}

/** 发起扫码登录：取 uuid，并把官方渲染的登录二维码图片转成 dataURL */
export async function cloudQrStart(): Promise<{ dataUrl: string }> {
  const store = new EncryptedTokenStore()
  const qrClient = new CloudClient({ token: store })
  const qrData = await qrClient.authClient.getQRCode()
  // image.do 直接返回官方渲染的登录二维码（内容为 App 确认页地址）。
  // 参数必须用 encodeURIComponent(uuid)：cloud189-sdk 的 getQRCode 是显式挑字段返回，
  // 天翼原始响应里的 encodeuuid 并不在返回对象上（d.ts 与运行时都没有）——
  // 取它会拼出 uuid=undefined，image.do 仍回 200，但给的是扫了无效的占位图。
  const resp = await fetch(
    `https://open.e.189.cn/api/logbox/oauth2/image.do?uuid=${encodeURIComponent(qrData.uuid)}`
  )
  if (!resp.ok) throw new Error(`二维码获取失败：HTTP ${resp.status}`)
  const buf = Buffer.from(await resp.arrayBuffer())
  const type = resp.headers.get('content-type') ?? 'image/png'
  qrSession = { client: qrClient, store, qrData }
  return { dataUrl: `data:${type};base64,${buf.toString('base64')}` }
}

/** 轮询扫码状态（渲染层 2~3 秒一次）；确认后完成会话建立并返回账号昵称 */
export async function cloudQrPoll(): Promise<CloudQrPoll> {
  if (!qrSession) return { state: 'expired' }
  if (qrPollBusy) return { state: 'waiting' }
  qrPollBusy = true
  try {
    const res = await qrSession.client.authClient.checkQRCodeStatus(qrSession.qrData)
    if (res.status === QRCodeStatus.SUCCESS) {
      return { state: 'done', username: await finishQrLogin(res.redirectUrl) }
    }
    if (res.status === QRCodeStatus.EXPIRED) return { state: 'expired' }
    if (res.status === QRCodeStatus.SCANNED) return { state: 'scanned' }
    return { state: 'waiting' }
  } finally {
    qrPollBusy = false
  }
}

/** 扫码确认后的收尾：redirectURL 换 token → 加密落盘 → 建立会话 */
async function finishQrLogin(redirectUrl?: string): Promise<string> {
  const session = qrSession
  if (!session) throw new Error('扫码会话已失效')
  if (!redirectUrl) throw new Error('扫码成功但缺少跳转参数，请重试')
  const loginToken = await session.client.authClient.getSessionForPC({ redirectURL: redirectUrl })
  // 与密码登录同一套 token 复用体系（有效期同 SDK 内部口径：6 天）
  await session.store.update({
    accessToken: loginToken.accessToken,
    refreshToken: loginToken.refreshToken,
    expiresIn: Date.now() + 6 * 24 * 60 * 60 * 1000
  })
  // 触发一次真实调用完成会话建立，token 无效则整体视为登录失败
  await session.client.getUserSizeInfo()
  client = session.client
  currentUsername = loginToken.loginName || '扫码登录'
  // 存昵称供重启恢复时展示；扫码登录不存密码
  setSetting<StoredCred>(CRED_KEY, { username: currentUsername })
  notifyReady()
  qrSession = null
  return currentUsername
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
  /** 最后修改时间（epoch ms）；解析失败缺省，扫描该章节退化为全量列举 */
  mtime?: number
}

/** 189 lastOpTime（'YYYY-MM-DD HH:mm:ss'，北京时间口径）→ epoch ms；非法输入返回 0。
 *  固定 +08:00 偏移只求「同字符串必得同数值」（变化检测自洽），不代表绝对时刻精确 */
function parse189Time(s: unknown): number {
  if (typeof s !== 'string' || !s) return 0
  const t = Date.parse(`${s.replace(' ', 'T')}+08:00`)
  return Number.isFinite(t) ? t : 0
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
    const resp = await listGate.run(() =>
      c.getListFiles(
        { folderId, pageSize, pageNum, iconOption: 1, orderBy: 1, descending: false },
        familyId
      )
    )
    const ao = resp.fileListAO
    for (const f of ao.folderList ?? []) {
      const mtime = parse189Time(f.lastOpTime)
      out.push({ id: f.id, name: f.name, size: 0, isDir: true, mtime: mtime || undefined })
    }
    for (const f of ao.fileList ?? []) {
      const mtime = parse189Time(f.lastOpTime)
      out.push({ id: f.id, name: f.name, size: f.size ?? 0, isDir: false, mtime: mtime || undefined })
    }
    // 某页缺字段时不能直接访问 length（防御 API 抖动把整库扫描打挂）
    if (
      out.length >= (ao.count ?? 0) ||
      ((ao.fileList?.length ?? 0) === 0 && (ao.folderList?.length ?? 0) === 0)
    ) {
      break
    }
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
