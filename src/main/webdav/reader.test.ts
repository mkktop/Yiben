import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createServer, type Server } from 'http'
import { execFileSync } from 'child_process'
import { path7za } from '7zip-bin'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => mock.dir } }))
vi.mock('../events', () => ({ broadcast: vi.fn() }))
vi.mock('../cloud189/client', () => ({
  cloudCacheDir: () => `${mock.dir}/cache/cloud189`,
  cloudDownloadUrl: vi.fn(),
  noteCloudError: () => null
}))
vi.mock('../cloud115/client', () => ({ cloud115CacheDir: () => `${mock.dir}/cache/115` }))
import {
  openDb,
  closeDb,
  addLibrary,
  upsertSeries,
  upsertChapter,
  replaceChapterPages
} from '../db'
import { setSetting } from '../settings'
import { ensureWebDavPage, ensureWebDavLocalPath, readWebDavPage } from './reader'
import { webdavCacheDir, webdavList } from './client'
import { offlineStatus, setOfflinePinned } from '../cloud189/offline'
import {
  ensureCached,
  resetIndex,
  withCacheMaintenance,
  cacheMaintenanceActive
} from '../cloud189/cache'

let server: Server,
  url = '',
  zip: Buffer,
  library = 0,
  series = 0,
  requests = 0,
  ranges = 0
const image = Buffer.from('页面字节不变')
const resource = (path: string): string => Buffer.from(path).toString('base64url')
function chapter(title: string, kind = 'zip', size = zip.length): number {
  return upsertChapter({
    series_id: series,
    title,
    volume: null,
    number: 1,
    sort_index: 0,
    path: join(webdavCacheDir(library), `${title}.cbz`),
    kind,
    page_count: kind === 'cfolder' ? 1 : 0,
    size,
    mtime: 0,
    cloud_file_id: kind === 'cfolder' ? null : resource(`${title}.cbz`)
  })
}
beforeAll(async () => {
  mock.dir = mkdtempSync(join(tmpdir(), 'yudu-dav-'))
  openDb()
  const source = join(mock.dir, 'zip-source')
  mkdirSync(source)
  writeFileSync(join(source, '1.png'), image)
  const archive = join(source, 'book.zip')
  execFileSync(path7za, ['a', '-tzip', archive, join(source, '1.png')], {
    stdio: 'ignore',
    windowsHide: true
  })
  zip = readFileSync(archive)
  server = createServer((req, res) => {
    requests++
    if (req.headers.authorization !== `Basic ${Buffer.from('u:p').toString('base64')}`) {
      res.writeHead(401)
      res.end()
      return
    }
    if (req.method === 'PROPFIND') {
      res.writeHead(207)
      res.end(
        '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/page.png</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:getcontentlength>18</d:getcontentlength></d:prop></d:propstat></d:response></d:multistatus>'
      )
      return
    }
    if (req.url === '/dav/slow.png') {
      res.writeHead(200, { 'Content-Length': '10' })
      res.write('12')
      return
    }
    if (req.url === '/dav/page.png') {
      res.writeHead(200, { 'Content-Length': image.length })
      res.end(image)
      return
    }
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d+)$/)
    if (range && req.url !== '/dav/fallback.cbz') {
      ranges++
      const start = Number(range[1]),
        end = Number(range[2])
      const chunk = zip.subarray(start, end + 1)
      res.writeHead(206, {
        'Content-Length': chunk.length,
        'Content-Range': `bytes ${start}-${end}/${zip.length}`
      })
      res.end(chunk)
    } else {
      res.writeHead(200, { 'Content-Length': zip.length })
      res.end(zip)
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/dav/`
  library = addLibrary('WebDAV 测试', 'webdav://test', 'webdav').id
  setSetting(`webdav:${library}`, { url, username: 'u', password: 'plain:v1:p' })
  series = upsertSeries({
    library_id: library,
    title: '测试漫画',
    author: null,
    description: null,
    status: null,
    tags: null,
    folder_path: 'webdav://series',
    is_single_file: 0
  })
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  closeDb()
  rmSync(mock.dir, { recursive: true, force: true })
})

describe('WebDAV 实际网络与离线读取', () => {
  it('PROPFIND 发送认证并解析目录', async () => {
    const entries = await webdavList(library)
    expect(entries[0].name).toBe('page.png')
  })
  it('ZIP 分段直读不落整包，页面字节保持', async () => {
    const id = chapter('range'),
      result = await ensureWebDavPage(id, 0)
    expect(result.kind).toBe('webdav-remotezip')
    expect(result.pageCount).toBe(1)
    expect(await readWebDavPage(result, 0)).toEqual(image)
    expect(ranges).toBeGreaterThan(0)
    expect(existsSync(result.path)).toBe(false)
  })
  it('无 Range 退回整包，缓存后不再访问服务；文件删除后完整状态立即失效', async () => {
    const id = chapter('fallback'),
      result = await ensureWebDavPage(id, 0)
    expect(result.kind).toBe('zip')
    expect(await readWebDavPage(result, 0)).toEqual(image)
    const before = requests
    expect(await ensureWebDavLocalPath(id)).toBe(result.path)
    expect(requests).toBe(before)
    expect((await offlineStatus(series)).missing).not.toContain('fallback')
    await rm(result.path)
    expect((await offlineStatus(series)).missing).toContain('fallback')
  })
  it('散图实际文件与大小核验，重新检查可发现残缺缓存', async () => {
    const id = chapter('散图', 'cfolder', 0)
    replaceChapterPages(id, [{ file_id: resource('page.png'), name: '1.png', size: image.length }])
    const result = await ensureWebDavPage(id, 0)
    expect(await readWebDavPage(result, 0)).toEqual(image)
    expect((await offlineStatus(series)).missing).not.toContain('散图')
    await writeFile(result.path, '残缺')
    expect((await offlineStatus(series)).missing).toContain('散图')
  })
  it('清理中等待流取消，阻止新下载且没有半成品重新落盘', async () => {
    const dir = await mkdtemp(join(mock.dir, 'clear-')),
      dest = join(dir, 'slow.png')
    let received!: () => void
    const firstChunk = new Promise<void>((resolve) => {
      received = resolve
    })
    const download = ensureCached(
      'slow',
      undefined,
      dest,
      10,
      received,
      undefined,
      async () => url + 'slow.png',
      { Authorization: `Basic ${Buffer.from('u:p').toString('base64')}` }
    )
    const outcome = download.catch((error: Error) => error)
    await firstChunk
    await withCacheMaintenance(async () => {
      expect(cacheMaintenanceActive()).toBe(true)
      await expect(ensureCached('new', undefined, dest, 10)).rejects.toThrow('正在清理')
      await rm(dir, { recursive: true, force: true })
      await resetIndex()
    })
    expect(await outcome).toBeInstanceOf(Error)
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(dest + '.part')).toBe(false)
    expect(cacheMaintenanceActive()).toBe(false)
  })
  it('受保护内容按总配额限制，并从 LRU 淘汰中保留', async () => {
    setSetting('cloudCacheCapMb', 1)
    const other = upsertSeries({
      library_id: library,
      title: '超额系列',
      author: null,
      description: null,
      status: null,
      tags: null,
      folder_path: 'webdav://large',
      is_single_file: 0
    })
    upsertChapter({
      series_id: other,
      title: '大章节',
      volume: null,
      number: 1,
      sort_index: 0,
      path: join(webdavCacheDir(library), 'large.cbz'),
      kind: 'zip',
      page_count: 1,
      size: 2 * 1024 * 1024,
      mtime: 0,
      cloud_file_id: resource('large.cbz')
    })
    expect((await offlineStatus(other)).capacityExceeded).toBe(true)
    expect(() => setOfflinePinned(other, true)).toThrow('缓存上限')
    setOfflinePinned(series, true)
    const pinned = await ensureWebDavLocalPath(chapter('pin'))
    // 强制缩小临时测试容量，普通缓存应被淘汰，受保护的漫画保留。
    setSetting('cloudCacheCapMb', 0.0001)
    const transient = join(webdavCacheDir(library), 'transient.png')
    await ensureCached(
      'temp',
      undefined,
      transient,
      image.length,
      undefined,
      undefined,
      async () => url + 'page.png',
      { Authorization: `Basic ${Buffer.from('u:p').toString('base64')}` }
    )
    expect(existsSync(pinned)).toBe(true)
    setSetting('cloudCacheCapMb', 20 * 1024)
  })
  it('大量并发下载只建立五条连接，清理也能取消排队的第六项', async () => {
    let chunks = 0
    const before = requests
    const jobs = Array.from({ length: 6 }, (_, index) =>
      ensureCached(
        `queue-${index}`,
        undefined,
        join(webdavCacheDir(library), `queue-${index}.png`),
        10,
        () => {
          chunks++
        },
        undefined,
        async () => url + 'slow.png',
        { Authorization: `Basic ${Buffer.from('u:p').toString('base64')}` }
      ).catch((error: Error) => error)
    )
    await vi.waitFor(() => expect(chunks).toBe(5))
    expect(requests - before).toBe(5)
    await withCacheMaintenance(async () => {})
    expect((await Promise.all(jobs)).every((result) => result instanceof Error)).toBe(true)
    expect(requests - before).toBe(5)
  })
  it('未知远端大小的保护文件也不能突破实际容量，失败不留下残缺文件', async () => {
    const id = chapter('unknown', 'zip', 0)
    setSetting('cloudCacheCapMb', 0.00001)
    const path = join(webdavCacheDir(library), 'unknown.cbz')
    await expect(ensureWebDavLocalPath(id)).rejects.toThrow('缓存容量')
    expect(existsSync(path)).toBe(false)
    expect(existsSync(path + '.part')).toBe(false)
    setSetting('cloudCacheCapMb', 20 * 1024)
  })
})
