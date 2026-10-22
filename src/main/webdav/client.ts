import { app } from 'electron'
import { createHash } from 'crypto'
import { join } from 'path'
import { XMLParser } from 'fast-xml-parser'
import { addLibrary, getLibrary, setLibraryCloudMeta } from '../db'
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
  const response = await fetch(resourceUrl(credentials.url, resource), {
    ...options,
    redirect: 'error',
    signal: options.signal ?? AbortSignal.timeout(30_000),
    headers: { ...credentials.headers, ...options.headers }
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

export async function webdavList(id: number, folder = 'root'): Promise<CloudEntry[]> {
  const response = await webdavRequest(id, folder, {
    method: 'PROPFIND',
    headers: { Depth: '1', 'Content-Type': 'application/xml' },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>'
  })
  return parseWebDavListing(await limitedText(response), webdavCredentials(id).url, folder)
}

export async function addWebDav(config: WebDavConfig): Promise<import('../db').LibraryRow> {
  if (
    !config ||
    ![config.name, config.url, config.username, config.password].every(
      (value) => typeof value === 'string'
    )
  )
    throw new Error('WebDAV 连接信息不完整')
  const url = normalizeWebDavUrl(config.url)
  if (!config.name.trim()) throw new Error('书库名称不能为空')
  const headers = {
    Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`,
    Depth: '0',
    'Content-Type': 'application/xml'
  }
  const response = await fetch(url, {
    method: 'PROPFIND',
    headers,
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
    redirect: 'error',
    signal: AbortSignal.timeout(30_000)
  })
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
  const identity = createHash('sha256').update(`${url}\0${config.username}`).digest('hex')
  const lib = addLibrary(config.name.trim(), `webdav://${identity}`, 'webdav')
  setSetting(`webdav:${lib.id}`, {
    url,
    username: config.username,
    password: encryptSecret(config.password)
  })
  setLibraryCloudMeta(lib.id, 'root', null)
  return getLibrary(lib.id)!
}
