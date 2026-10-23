import { app } from 'electron'
import { getSetting, setSetting } from '../settings'
import { broadcast } from '../events'
import { decryptSecret, encryptSecret } from '../util/secret'
import { MinIntervalChain } from '../util/apiGate'
import {
  buildCookieHeader,
  extractDownloadUrl,
  isRateLimitJson,
  isSessionErrorJson,
  mapQrStatus,
  parseListResponse,
  parseLoginCookie,
  parseSpaceInfo,
  parseUsername,
  type CloudEntry,
  type ParsedCredential
} from './parsing'

// ---------- 接口端点（与官方网页端 / aList / p115client 同源口径） ----------

const QR_TOKEN_URL = 'https://qrcodeapi.115.com/api/1.0/web/1.0/token/'
const QR_IMAGE_URL = 'https://qrcodeapi.115.com/api/1.0/mac/1.0/qrcode?uid='
const QR_STATUS_URL = 'https://qrcodeapi.115.com/get/status/'
/** 用 tv 设备类型换 cookie：避免顶掉用户手机/网页端已登录的会话（aList 同款建议） */
const QR_LOGIN_URL = 'https://passportapi.115.com/app/1.0/tv/1.0/login/qrcode/'
const FILE_LIST_URL = 'https://webapi.115.com/files'
const DOWNLOAD_URL_API = 'https://webapi.115.com/files/download'
const INDEX_INFO_URL = 'https://webapi.115.com/files/index_info'
const USER_NAV_URL = 'https://my.115.com/?ct=ajax&ac=nav'

/** 与官方网页端一致的浏览器 UA。取下载直链按 p115client 的做法用「空 UA」换与 UA 无关的链接 */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** 列表接口的单页上限（115driver 的 MaxDirPageLimit 同值） */
const PAGE_LIMIT = 1150

// ---------- 凭据存取（safeStorage 加密后存 settings 表） ----------

const CRED_KEY = 'cloud115-cred'

interface StoredCred115 {
  /** safeStorage 加密后的凭据 JSON */
  enc: string
  /** 账号昵称（明文展示用，非敏感） */
  name?: string
}

function loadStored(): { cred: ParsedCredential; name: string } | null {
  const rec = getSetting<StoredCred115 | null>(CRED_KEY, null)
  if (!rec?.enc) return null
  try {
    const cred = JSON.parse(decryptSecret(rec.enc)) as ParsedCredential
    if (cred.uid && cred.cid && cred.seid) return { cred, name: rec.name ?? '' }
  } catch {
    /* 凭据损坏按未登录处理 */
  }
  return null
}

function saveStored(cred: ParsedCredential, name: string): void {
  const rec: StoredCred115 = { enc: encryptSecret(JSON.stringify(cred)) }
  if (name) rec.name = name
  setSetting(CRED_KEY, rec)
}

let cred: ParsedCredential | null = null
let credUsername = ''

function requireCred(): ParsedCredential {
  if (!cred) throw new Error('115 网盘未登录')
  return cred
}

// ---------- 接口访问（限流 + 错误识别） ----------

/**
 * 115 的 web 接口对请求频率敏感（aList 默认 2 r/s 限速）。
 * 所有 115 API 调用串行通过这个队列并保持最小间隔；CDN 下载不经过它。
 * 必须把执行体本身串进链：只串行「间隔检查」时，慢请求（20s 超时内）执行期间
 * 后续请求照样并发在途，正是 990007 风控敏感的 burst 形态。
 */
const API_MIN_INTERVAL_MS = 400
const apiGate = new MinIntervalChain(API_MIN_INTERVAL_MS)

function apiSlot<T>(fn: () => Promise<T>): Promise<T> {
  return apiGate.run(fn)
}

/** 同类型告警 60 秒内只广播一次（与 cloud189 的 noteCloudError 同策略） */
const noticedAt = new Map<string, number>()

function notice(kind: 'session' | 'ratelimit', message: string): void {
  const last = noticedAt.get(kind) ?? 0
  if (Date.now() - last >= 60_000) {
    noticedAt.set(kind, Date.now())
    broadcast('cloud:notice', { kind, provider: '115', message })
  }
}

/** 识别 115 报错里的会话失效 / 限流并广播；会话失效时清内存凭据，让状态如实反映未登录 */
function noteApiError(err: unknown): 'session' | 'ratelimit' | null {
  const msg = err instanceof Error ? err.message : String(err)
  if (/990001|登录超时|请先登录|未登录/.test(msg)) {
    notice('session', '115 网盘登录已失效，请到「网盘」页重新连接')
    if (cred) {
      cred = null
      credUsername = ''
    }
    return 'session'
  }
  if (/990007|访问太频繁|操作频繁/.test(msg)) {
    notice('ratelimit', '115 网盘请求过于频繁被限流，请稍后再试')
    return 'ratelimit'
  }
  return null
}

interface ApiJsonState {
  state?: boolean | number
  errNo?: number
  errno?: number
  error?: string
}

/**
 * 发起 115 API 请求并解析 JSON。自动带 cookie 与浏览器 UA；
 * 会话失效/限流在出口统一识别广播。115 部分接口对异常网络环境返回 HTML 拦截页，
 * 这里转成可读错误而不是裸的 JSON 语法错误。
 */
async function apiJson<T>(
  url: string,
  init: RequestInit = {},
  opts: { rawUa?: boolean } = {}
): Promise<T> {
  return apiSlot(async () => {
    const headers: Record<string, string> = {
      accept: 'application/json, text/plain, */*',
      referer: 'https://115.com/'
    }
    // p115client 口径：取下载直链时空 UA，服务端返回与 UA 无关的 CDN 链接
    headers['user-agent'] = opts.rawUa ? '' : BROWSER_UA
    if (cred) headers.cookie = buildCookieHeader(cred)
    if (init.body) headers['content-type'] = 'application/x-www-form-urlencoded'

    let resp: Response
    try {
      resp = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(20_000) })
    } catch (err) {
      throw new Error(
        `115 接口连接失败：${err instanceof Error ? err.message : err}（请检查网络，115 对部分网络环境有限制）`
      )
    }
    const text = await resp.text()
    if (resp.status === 405 || text.startsWith('<!doctype') || text.startsWith('<!DOCTYPE')) {
      throw new Error(`115 接口访问受限：HTTP ${resp.status}（当前网络环境可能不被 115 支持）`)
    }
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw new Error('115 接口返回了无法解析的内容（可能被网络中间层拦截）')
    }
    const s = json as ApiJsonState
    if (s.state === false || s.state === 0) {
      if (isSessionErrorJson(s)) noteApiError(new Error(`990001 ${s.error ?? ''}`))
      else if (isRateLimitJson(s)) noteApiError(new Error(s.error ?? '990007'))
    }
    return json as T
  })
}

// ---------- 登录态与扫码登录 ----------

export interface Cloud115Status {
  loggedIn: boolean
  username: string
}

export function cloud115Status(): Cloud115Status {
  return { loggedIn: cred !== null, username: credUsername }
}

export function cloud115Logout(): Cloud115Status {
  cred = null
  credUsername = ''
  qrSession = null
  setSetting(CRED_KEY, null)
  return cloud115Status()
}

/** 启动恢复：凭据是长效 cookie，解密即用；有效性由后续真实请求自然验证 */
export function cloud115Restore(): void {
  if (cred) return
  const stored = loadStored()
  if (!stored) return
  cred = stored.cred
  credUsername = stored.name
}

/** 用 nav 接口拉账号昵称，取不到回退 UID 前缀展示 */
async function refreshUsername(): Promise<string> {
  const c = requireCred()
  try {
    const json = await apiJson<{ state?: boolean | number; data?: unknown }>(
      `${USER_NAV_URL}?_=${Date.now()}`
    )
    return parseUsername(json) ?? `UID ${c.uid.slice(0, 8)}`
  } catch (err) {
    noteApiError(err)
    return `UID ${c.uid.slice(0, 8)}`
  }
}

interface QrSession {
  uid: string
  time: string
  sign: string
}

let qrSession: QrSession | null = null

export interface Cloud115QrPoll {
  state: 'waiting' | 'scanned' | 'done' | 'expired'
  username?: string
}

/** 发起扫码登录：取 token，并把官方渲染的二维码图片（内容即 App 确认页地址）转成 dataURL */
export async function cloud115QrStart(): Promise<{ dataUrl: string }> {
  const tokenResp = await apiSlot(async () => {
    const resp = await fetch(QR_TOKEN_URL, {
      headers: { 'user-agent': BROWSER_UA },
      signal: AbortSignal.timeout(15_000)
    })
    if (!resp.ok) throw new Error(`二维码获取失败：HTTP ${resp.status}`)
    return (await resp.json()) as { state?: number; data?: QrSession & { qrcode?: string } }
  })
  const data = tokenResp.data
  if (tokenResp.state !== 1 || !data?.uid || !data.time || !data.sign) {
    throw new Error('二维码获取失败：115 接口返回异常')
  }
  qrSession = { uid: data.uid, time: String(data.time), sign: data.sign }
  const img = await fetch(`${QR_IMAGE_URL}${encodeURIComponent(data.uid)}`, {
    headers: { 'user-agent': BROWSER_UA },
    signal: AbortSignal.timeout(15_000)
  })
  if (!img.ok) throw new Error(`二维码图片获取失败：HTTP ${img.status}`)
  const buf = Buffer.from(await img.arrayBuffer())
  const type = img.headers.get('content-type') ?? 'image/png'
  return { dataUrl: `data:${type};base64,${buf.toString('base64')}` }
}

/** 单次状态查询：GET 优先（官方口径，部分网络下会被静默断开），失败自动降级 POST 表单 */
async function fetchQrStatus(session: QrSession): Promise<ReturnType<typeof mapQrStatus>> {
  const qs = `uid=${encodeURIComponent(session.uid)}&time=${encodeURIComponent(session.time)}&sign=${encodeURIComponent(session.sign)}`
  const parse = (text: string): ReturnType<typeof mapQrStatus> => {
    const json = JSON.parse(text) as {
      state?: boolean | number
      data?: { status?: number }
      status?: number
    }
    if (json.state === false) throw new Error('二维码会话已失效')
    return mapQrStatus(json)
  }
  try {
    const resp = await fetch(`${QR_STATUS_URL}?${qs}`, {
      headers: { 'user-agent': BROWSER_UA, referer: 'https://115.com/' },
      signal: AbortSignal.timeout(8_000)
    })
    const text = await resp.text()
    if (resp.ok && !text.startsWith('<')) return parse(text)
  } catch {
    /* GET 超时/被断开 → 走 POST 兜底 */
  }
  const resp = await fetch(QR_STATUS_URL, {
    method: 'POST',
    headers: {
      'user-agent': BROWSER_UA,
      'content-type': 'application/x-www-form-urlencoded',
      referer: 'https://115.com/'
    },
    body: qs,
    signal: AbortSignal.timeout(8_000)
  })
  const text = await resp.text()
  if (text.startsWith('<')) throw new Error('二维码状态查询失败：接口返回异常内容')
  return parse(text)
}

/** 轮询扫码状态（渲染层 2~3 秒一次）；确认后用 tv 设备身份换 cookie 并完成会话建立 */
export async function cloud115QrPoll(): Promise<Cloud115QrPoll> {
  if (!qrSession) return { state: 'expired' }
  let status: ReturnType<typeof mapQrStatus>
  try {
    status = await fetchQrStatus(qrSession)
  } catch {
    // 网络抖动/接口抽风按「继续等待」处理，下一轮轮询再试；不中断扫码流程
    return { state: 'waiting' }
  }
  if (status === 'allowed') {
    const session = qrSession
    qrSession = null
    const username = await finishQrLogin(session)
    return { state: 'done', username }
  }
  if (status === 'expired' || status === 'canceled' || status === 'invalid') {
    qrSession = null
    return { state: 'expired' }
  }
  return { state: status === 'scanned' ? 'scanned' : 'waiting' }
}

/** 已扫码确认：passportapi 换 cookie → 验证会话 → 加密落盘 */
async function finishQrLogin(session: QrSession): Promise<string> {
  const resp = await apiSlot(async () =>
    fetch(QR_LOGIN_URL, {
      method: 'POST',
      headers: {
        'user-agent': BROWSER_UA,
        'content-type': 'application/x-www-form-urlencoded',
        referer: 'https://115.com/'
      },
      body: `account=${encodeURIComponent(session.uid)}&app=tv`,
      signal: AbortSignal.timeout(20_000)
    })
  )
  const json = (await resp.json()) as {
    state?: boolean | number
    error?: string
    data?: { cookie?: Record<string, string> }
  }
  const parsed = parseLoginCookie(json)
  // 先带着新 cookie 做一次真实调用验证会话可用，再落盘
  const prev = cred
  cred = parsed
  try {
    await apiJson(INDEX_INFO_URL)
  } catch (err) {
    cred = prev
    noteApiError(err)
    throw new Error('扫码成功但会话验证失败，请重试')
  }
  credUsername = await refreshUsername()
  saveStored(parsed, credUsername)
  return credUsername
}

// ---------- 列目录 / 下载直链 / 容量 ----------

/**
 * 列出目录（自动翻页）。webapi 的 /files 已改为 POST 表单（GET 会被 405 拦截）。
 * 出口统一做会话/限流识别。
 */
export async function cloud115ListAll(folderId: string): Promise<CloudEntry[]> {
  const cid = /^\d+$/.test(folderId) ? folderId : '0'
  const out: CloudEntry[] = []
  try {
    for (let offset = 0; ; offset += PAGE_LIMIT) {
      const body =
        `aid=1&cid=${encodeURIComponent(cid)}&o=user_ptime&asc=1&offset=${offset}` +
        `&show_dir=1&limit=${PAGE_LIMIT}&snap=0&natsort=1&record_open_time=1&format=json&fc_mix=0`
      const resp = await apiJson<Parameters<typeof parseListResponse>[0]>(FILE_LIST_URL, {
        method: 'POST',
        body
      })
      const { entries, count } = parseListResponse(resp)
      out.push(...entries)
      if (entries.length === 0 || (count > 0 && out.length >= count)) break
    }
  } catch (err) {
    noteApiError(err)
    throw err
  }
  return out
}

/** 获取下载直链（有时效，用前即取；空 UA 换取与 UA 无关的 CDN 链接） */
export async function cloud115DownloadUrl(pickcode: string): Promise<string> {
  try {
    const json = await apiJson<{
      state?: boolean | number
      error?: string
      url?: { url?: string } | string
    }>(`${DOWNLOAD_URL_API}?pickcode=${encodeURIComponent(pickcode)}&t=${Date.now()}`, {}, { rawUa: true })
    return extractDownloadUrl(json)
  } catch (err) {
    noteApiError(err)
    throw err
  }
}

/** 空间容量（index_info 同时充当会话有效性探针） */
export async function cloud115Capacity(): Promise<{ total: number; free: number }> {
  try {
    const json = await apiJson<Parameters<typeof parseSpaceInfo>[0]>(INDEX_INFO_URL)
    if (json.state === false || json.state === 0) return { total: 0, free: 0 }
    return parseSpaceInfo(json)
  } catch (err) {
    noteApiError(err)
    throw err
  }
}

export function cloud115CacheDir(): string {
  return app.getPath('userData') + '/cache/cloud115'
}
