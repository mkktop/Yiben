/**
 * 115 网盘接口的纯解析逻辑。与 electron/网络完全解耦，便于单元测试。
 * 响应字段口径参考开源实现（aList 115 驱动 / p115client / SheltonZhu 115driver）：
 *  - 列表项：文件有 fid（文件 id）与 pc（pickcode，下载凭证）；目录没有 fid，
 *    它的 cid 就是目录自身 id（文件项的 cid 是父目录 id）
 *  - 数字字段可能以字符串下发，统一做宽容解析
 */

export interface CloudEntry {
  id: string
  name: string
  size: number
  isDir: boolean
}

interface RawListItem {
  fid?: string | null
  cid?: string | number | null
  n?: string
  s?: string | number
  pc?: string | null
}

/** 宽容地把 string | number 解析成数字（115 各接口口径不一） */
export function toNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/** 单条列表项 → CloudEntry；缺关键属性（名称/id）时返回 null 跳过 */
export function parseListEntry(raw: RawListItem): CloudEntry | null {
  const name = typeof raw.n === 'string' ? raw.n : ''
  if (!name) return null
  const isDir = !raw.fid
  const id = isDir ? raw.cid : raw.fid || raw.pc
  const idStr = id === undefined || id === null ? '' : String(id)
  if (!idStr) return null
  if (isDir) return { id: idStr, name, size: 0, isDir: true }
  // 文件的下载走 pickcode，直接用它当条目 id；pc 缺失的条目无法下载，跳过
  if (!raw.pc) return null
  return { id: String(raw.pc), name, size: toNum(raw.s), isDir: false }
}

export interface RawListResponse {
  state?: boolean | number
  error?: string
  errNo?: number
  errno?: number
  count?: string | number
  data?: RawListItem[] | unknown
}

/** 列表接口整包解析；state=false 时按错误抛出 */
export function parseListResponse(json: RawListResponse): { entries: CloudEntry[]; count: number } {
  if (json.state === false || json.state === 0) {
    throw new Error(json.error || `115 列目录失败（errNo ${json.errNo ?? json.errno ?? '?'}）`)
  }
  const data = Array.isArray(json.data) ? json.data : []
  const entries: CloudEntry[] = []
  for (const raw of data) {
    const entry = parseListEntry(raw as RawListItem)
    if (entry) entries.push(entry)
  }
  return { entries, count: toNum(json.count) }
}

export interface RawQrStatusResponse {
  state?: boolean | number
  code?: number
  message?: string
  /** 状态值可能在 data.status（文档口径）或顶层 status（旧口径） */
  data?: { status?: number } | null
  status?: number
}

export type QrPollState = 'waiting' | 'scanned' | 'allowed' | 'expired' | 'canceled' | 'invalid'

/** 轮询响应 → 扫码状态机；invalid 表示会话已失效（需要重新取码） */
export function mapQrStatus(json: RawQrStatusResponse): QrPollState {
  const status = json.data?.status ?? json.status
  switch (status) {
    case 0:
      return 'waiting'
    case 1:
      return 'scanned'
    case 2:
      return 'allowed'
    case -1:
      return 'expired'
    case -2:
      return 'canceled'
    default:
      return 'invalid'
  }
}

/** 登录换 cookie 的响应：data.cookie = { UID, CID, SEID, KID? } */
export interface ParsedCredential {
  uid: string
  cid: string
  seid: string
  kid?: string
}

interface RawLoginResponse {
  state?: boolean | number
  error?: string
  data?: { cookie?: Record<string, string> } | null
}

export function parseLoginCookie(json: RawLoginResponse): ParsedCredential {
  const cookie = json.data?.cookie
  const uid = cookie?.UID ?? cookie?.uid ?? ''
  const cid = cookie?.CID ?? cookie?.cid ?? ''
  const seid = cookie?.SEID ?? cookie?.seid ?? ''
  if (json.state === false || !uid || !cid || !seid) {
    throw new Error(json.error || '扫码登录失败：未取到登录凭据')
  }
  return { uid, cid, seid, kid: cookie?.KID ?? cookie?.kid ?? undefined }
}

/** 请求头里的 Cookie 串（115 口径：分号分隔、无空格） */
export function buildCookieHeader(cred: ParsedCredential): string {
  const parts = [`UID=${cred.uid}`, `CID=${cred.cid}`, `SEID=${cred.seid}`]
  if (cred.kid) parts.push(`KID=${cred.kid}`)
  return parts.join(';')
}

interface RawDownloadResponse {
  state?: boolean | number
  error?: string
  /** 兼容两种形态：url 为对象（url.url）或直接是字符串 */
  url?: { url?: string } | string
}

/** 下载直链提取；空 UA 请求的响应里 url 对象可能带 UA 绑定说明，这里只取链接本身 */
export function extractDownloadUrl(json: RawDownloadResponse): string {
  if (json.state === false || json.state === 0) {
    throw new Error(json.error || '115 取下载直链失败')
  }
  const url = typeof json.url === 'string' ? json.url : json.url?.url
  if (!url || url === 'false' || url === 'null') {
    throw new Error('115 直链获取失败：响应缺少下载地址')
  }
  return url
}

/** 会话失效（未登录/登录超时）识别：errNo 990001 是 115 的标准未登录码 */
export function isSessionErrorJson(json: { state?: unknown; errNo?: number; errno?: number; error?: string }): boolean {
  if (json.state === false || json.state === 0) {
    if (json.errNo === 990001 || json.errno === 990001) return true
    if (typeof json.error === 'string' && /登录超时|请.{0,4}登录|未登录/.test(json.error)) return true
  }
  return false
}

/** 限流识别（115 对高频访问返回 errNo 990007 / 文案提示） */
export function isRateLimitJson(json: { errNo?: number; errno?: number; error?: string }): boolean {
  if (json.errNo === 990007 || json.errno === 990007) return true
  return typeof json.error === 'string' && /访问太频繁|操作频繁|稍后再试/.test(json.error)
}

interface RawIndexInfoResponse {
  state?: boolean | number
  data?: {
    space_info?: {
      all_total?: { size?: boolean | string | number } | null
      all_use?: { size?: boolean | string | number } | null
    } | null
  } | null
}

/** index_info 的容量解析（all_total / all_use 的 size 字段） */
export function parseSpaceInfo(json: RawIndexInfoResponse): { total: number; free: number } {
  const size = (v: unknown): number => {
    // size 字段可能是 {size: 数字} 也可能直接嵌套对象，宽容处理
    if (typeof v === 'boolean' || v === null || v === undefined) return 0
    return toNum(v)
  }
  const total = size(json.data?.space_info?.all_total?.size)
  const used = size(json.data?.space_info?.all_use?.size)
  return { total, free: Math.max(0, total - used) }
}

/** my.115.com nav 的昵称提取；取不到时返回 null（调用方回退显示 UID） */
export function parseUsername(json: {
  state?: unknown
  data?: { user_name?: string; uname?: string; userinfo?: { user_name?: string } } | unknown
}): string | null {
  if (!json || typeof json !== 'object' || json.state === false) return null
  const d = json.data as { user_name?: string; uname?: string; userinfo?: { user_name?: string } } | undefined
  const name = d?.user_name ?? d?.uname ?? d?.userinfo?.user_name
  return typeof name === 'string' && name ? name : null
}
