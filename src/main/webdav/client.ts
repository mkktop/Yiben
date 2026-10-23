import { app } from 'electron'
import { createHash } from 'crypto'
import { join } from 'path'
import { XMLParser } from 'fast-xml-parser'
import { addLibrary, getLibrary, renameLibrary, setLibraryCloudMeta, updateLibraryPath } from '../db'
import { getSetting, setSetting } from '../settings'
import { encryptSecret, decryptSecret } from '../util/secret'
import type { CloudEntry } from '../cloud115/parsing'
import type { WebDavConfig } from '../../shared/types'

export const webdavCacheRoot = (): string => join(app.getPath('userData'), 'cache', 'webdav')
export const webdavCacheDir = (id: number): string => join(webdavCacheRoot(), String(id))

export function normalizeWebDavUrl(value: string): string {
  const url = new URL(value)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('请输入不含凭据或查询参数的 HTTP/HTTPS WebDAV 目录地址')
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.href
}
export function webdavCredentials(id: number): { url: string; headers: Record<string, string> } {
  const saved = getSetting<{ url: string; username: string; password: string } | null>(
    `webdav:${id}`,
    null
  )
  if (!saved) throw new Error('WebDAV 配置不存在，请重新添加连接')
  return {
    url: saved.url,
    headers: {
      Authorization: `Basic ${Buffer.from(`${saved.username}:${decryptSecret(saved.password)}`).toString('base64')}`
    }
  }
}

export function resourceUrl(base: string, id: string): string {
  const path = id === 'root' ? '' : Buffer.from(id, 'base64url').toString('utf8')
  const decoded = decodeURIComponent(path)
  if (decoded.includes('\\') || decoded.split('/').some((part) => part === '.' || part === '..'))
    throw new Error('WebDAV 路径无效')
  const url = new URL(path, base)
  if (url.origin !== new URL(base).origin || !url.pathname.startsWith(new URL(base).pathname))
    throw new Error('WebDAV 路径超出挂载目录')
  return url.href
}

export async function webdavRequest(
  id: number,
  resource: string,
  options: RequestInit = {}
): Promise<Response> {
  const credentials = webdavCredentials(id)
  return davFetch(resourceUrl(credentials.url, resource), credentials.headers, options)
}

/** Basic 认证头（连接表单与已保存配置共用同一拼法） */
function authHeaders(username: string, password: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  }
}

/** WebDAV 请求统一出口：禁止跟随重定向（防目录被重定向到别处后静默串台），30 秒超时 */
async function davFetch(
  url: string,
  headers: Record<string, string>,
  options: RequestInit = {}
): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    redirect: 'error',
    signal: options.signal ?? AbortSignal.timeout(30_000),
    headers: { ...headers, ...options.headers }
  })
  if (response.status === 401 || response.status === 403)
    throw new Error('WebDAV 认证失败，请检查用户名和密码')
  if (!response.ok) throw new Error(`WebDAV 请求失败：HTTP ${response.status}`)
  return response
}

export async function limitedBuffer(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > limit) {
        await reader.cancel()
        throw new Error('服务器响应过大')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}

export async function limitedText(response: Response, limit = 8 * 1024 * 1024): Promise<string> {
  return (await limitedBuffer(response, limit)).toString('utf8')
}

export function parseWebDavListing(xml: string, base: string, folder: string): CloudEntry[] {
  const parsed = new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: false,
    isArray: (name) => name === 'response' || name === 'propstat'
  }).parse(xml)
  const folderUrl = new URL(resourceUrl(base, folder))
  const seen = new Set<string>()
  const entries: CloudEntry[] = []
  for (const item of parsed?.multistatus?.response ?? []) {
    if (typeof item.href !== 'string') continue
    const url = new URL(item.href, folderUrl)
    if (url.origin !== folderUrl.origin || !url.pathname.startsWith(folderUrl.pathname)) continue
    const tail = url.pathname.slice(folderUrl.pathname.length).replace(/\/$/, '')
    if (!tail || tail.includes('/') || seen.has(url.pathname)) continue
    const prop = (item.propstat ?? []).find((entry: { status?: string }) =>
      /\s200\s/.test(entry.status ?? '')
    )?.prop
    if (!prop) continue
    const isDir =
      prop.resourcetype && Object.prototype.hasOwnProperty.call(prop.resourcetype, 'collection')
    const relative = url.pathname.slice(new URL(base).pathname.length)
    const id = Buffer.from(relative).toString('base64url')
    seen.add(url.pathname)
    const mtime = Date.parse(String(prop.getlastmodified ?? ''))
    entries.push({
      id,
      name: decodeURIComponent(tail),
      isDir: Boolean(isDir),
      size: Math.max(0, Number(prop.getcontentlength) || 0),
      mtime: Number.isFinite(mtime) ? mtime : undefined
    })
  }
  return entries
}

const PROPFIND_LIST_BODY =
  '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>'

export async function webdavList(id: number, folder = 'root'): Promise<CloudEntry[]> {
  const { url, headers } = webdavCredentials(id)
  return webdavListByCreds(url, headers, folder)
}

/** 按连接表单里的凭据列目录（添加书库前的浏览阶段，配置尚未落库） */
export async function webdavListByCreds(
  baseUrl: string,
  headers: Record<string, string>,
  folder = 'root'
): Promise<CloudEntry[]> {
  const response = await davFetch(resourceUrl(baseUrl, folder), headers, {
    method: 'PROPFIND',
    headers: { Depth: '1', 'Content-Type': 'application/xml' },
    body: PROPFIND_LIST_BODY
  })
  return parseWebDavListing(await limitedText(response), baseUrl, folder)
}

/** Depth:0 验证地址确为可访问的目录集合（连接/改凭据时给出准确报错而非笼统失败） */
export async function verifyWebDavCollection(
  url: string,
  headers: Record<string, string>
): Promise<void> {
  const response = await fetch(url, {
    method: 'PROPFIND',
    headers: { ...headers, Depth: '0', 'Content-Type': 'application/xml' },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
    redirect: 'error',
    signal: AbortSignal.timeout(30_000)
  })
  if (response.status === 401 || response.status === 403)
    throw new Error('WebDAV 认证失败，请检查用户名和密码')
  if (response.status !== 207) throw new Error(`WebDAV 连接验证失败：HTTP ${response.status}`)
  const parsed = new XMLParser({
    removeNSPrefix: true,
    isArray: (name) => name === 'response' || name === 'propstat'
  }).parse(await limitedText(response))
  const valid = (parsed?.multistatus?.response ?? []).some(
    (entry: {
      href?: string
      propstat?: Array<{ status?: string; prop?: { resourcetype?: object } }>
    }) => {
      if (typeof entry.href !== 'string') return false
      const resource = new URL(entry.href, url)
      return (
        resource.origin === new URL(url).origin &&
        resource.pathname.replace(/\/$/, '') === new URL(url).pathname.replace(/\/$/, '') &&
        entry.propstat?.some(
          (item) =>
            /\s200\s/.test(item.status ?? '') &&
            item.prop?.resourcetype &&
            Object.prototype.hasOwnProperty.call(item.prop.resourcetype, 'collection')
        )
      )
    }
  )
  if (!valid) throw new Error('WebDAV 地址不是可访问的目录，请检查挂载路径与权限')
}

/** 连接身份：同地址 + 同用户名视为同一连接（换密码不变，换地址/用户名则变） */
export function webdavMountIdentity(mountUrl: string, username: string): string {
  return createHash('sha256').update(`${mountUrl}\0${username}`).digest('hex')
}

/** 连接表单「连接」：验证地址可达 + 列出根目录内容（配置未落库，纯按凭据） */
export async function webdavProbe(c: {
  url: string
  username: string
  password: string
}): Promise<CloudEntry[]> {
  const url = normalizeWebDavUrl(c.url)
  const headers = authHeaders(c.username, c.password)
  await verifyWebDavCollection(url, headers)
  return webdavListByCreds(url, headers, 'root')
}

/** 挂载前的目录浏览（与 probe 同一凭据，逐层下钻） */
export async function webdavBrowseByCreds(
  c: { url: string; username: string; password: string },
  folder: string
): Promise<CloudEntry[]> {
  return webdavListByCreds(
    normalizeWebDavUrl(c.url),
    authHeaders(c.username, c.password),
    folder
  )
}

export async function addWebDav(config: WebDavConfig): Promise<import('../db').LibraryRow> {
  if (
    !config ||
    ![config.name, config.url, config.username, config.password].every(
      (value) => typeof value === 'string'
    )
  )
    throw new Error('WebDAV 连接信息不完整')
  if (!config.name.trim()) throw new Error('书库名称不能为空')
  const base = normalizeWebDavUrl(config.url)
  // 挂载点 = 浏览阶段选中的子目录（缺省为连接地址本身）；再次验证避免选完目录后服务端状态变化
  const mountUrl =
    config.rootId && config.rootId !== 'root' ? resourceUrl(base, config.rootId) : base
  const headers = authHeaders(config.username, config.password)
  await verifyWebDavCollection(mountUrl, headers)
  const lib = addLibrary(
    config.name.trim(),
    `webdav://${webdavMountIdentity(mountUrl, config.username)}`,
    'webdav'
  )
  setSetting(`webdav:${lib.id}`, {
    url: mountUrl,
    username: config.username,
    password: encryptSecret(config.password)
  })
  setLibraryCloudMeta(lib.id, 'root', null)
  return getLibrary(lib.id)!
}

/**
 * 修改已挂载书库的连接信息（改密码不用删库重建，阅读进度不受影响）。
 * 密码留空 = 保持原密码；地址/用户名变化会同步连接身份（path），
 * 已扫到的系列路径不变，重扫后按新地址重新对账。
 */
export async function updateWebDav(
  id: number,
  patch: { name?: string; url?: string; username?: string; password?: string }
): Promise<import('../db').LibraryRow> {
  const saved = getSetting<{ url: string; username: string; password: string } | null>(
    `webdav:${id}`,
    null
  )
  if (!saved) throw new Error('WebDAV 配置不存在，请重新添加连接')
  const url = patch.url?.trim() ? normalizeWebDavUrl(patch.url) : saved.url
  const username = patch.username?.trim() || saved.username
  const password = patch.password || decryptSecret(saved.password)
  if (patch.name !== undefined && !patch.name.trim()) throw new Error('书库名称不能为空')
  await verifyWebDavCollection(url, authHeaders(username, password))
  setSetting(`webdav:${id}`, {
    url,
    username,
    password: patch.password ? encryptSecret(patch.password) : saved.password
  })
  // 身份变了同步 path，保证同一新连接重复添加仍然幂等去重
  updateLibraryPath(id, `webdav://${webdavMountIdentity(url, username)}`)
  if (patch.name?.trim()) renameLibrary(id, patch.name.trim())
  return getLibrary(id)!
}
