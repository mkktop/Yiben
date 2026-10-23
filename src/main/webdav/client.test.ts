import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({
  app: { getPath: () => 'D:/test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../db', () => ({
  addLibrary: vi.fn(() => ({ id: 7 })),
  getLibrary: vi.fn(() => ({ id: 7, name: '书库' })),
  setLibraryCloudMeta: vi.fn(),
  renameLibrary: vi.fn(),
  updateLibraryPath: vi.fn()
}))
vi.mock('../settings', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn()
}))
import {
  normalizeWebDavUrl,
  resourceUrl,
  parseWebDavListing,
  limitedText,
  addWebDav,
  updateWebDav,
  webdavMountIdentity,
  webdavProbe
} from './client'
import { getSetting, setSetting } from '../settings'
import { addLibrary, renameLibrary, updateLibraryPath } from '../db'
afterEach(() => vi.unstubAllGlobals())
const base = 'https://nas.example/dav/漫画/'
describe('WebDAV 目录与路径约束', () => {
  it('规范目录地址并拒绝混入认证、查询或非 HTTP 协议', () => {
    expect(normalizeWebDavUrl('https://nas.example/dav')).toBe('https://nas.example/dav/')
    for (const url of [
      'file:///D:/book',
      'https://user:pass@nas.example/dav',
      'https://nas.example/dav?token=1'
    ])
      expect(() => normalizeWebDavUrl(url)).toThrow()
  })
  it('读取多状态目录，过滤根目录、孙级路径、重复、失败及外站响应', () => {
    const root = new URL(base).pathname
    const item = (
      href: string,
      prop = '<d:getcontentlength>12</d:getcontentlength>',
      status = 'HTTP/1.1 200 OK'
    ): string =>
      `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${prop}</d:prop><d:status>${status}</d:status></d:propstat></d:response>`
    const xml = `<d:multistatus xmlns:d="DAV:">${item(root)}${item(root + '%E7%AC%AC1%E5%8D%B7/', '<d:resourcetype><d:collection/></d:resourcetype>')}${item(root + '1.cbz')}${item(root + '1.cbz')}${item(root + 'deep/1.png')}${item('https://evil.example/dav/1.cbz')}${item(root + 'bad.cbz', '', 'HTTP/1.1 403 Forbidden')}</d:multistatus>`
    const result = parseWebDavListing(xml, new URL(base).href, 'root')
    expect(result.map((entry) => [entry.name, entry.isDir, entry.size])).toEqual([
      ['第1卷', true, 0],
      ['1.cbz', false, 12]
    ])
    expect(resourceUrl(new URL(base).href, result[0].id)).toBe(
      new URL(base).href + '%E7%AC%AC1%E5%8D%B7/'
    )
  })

  it('getlastmodified 解析为 mtime，缺省或非法时不设置', () => {
    const root = new URL(base).pathname
    const item = (href: string, prop = ''): string =>
      `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${prop}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
    const xml =
      `<d:multistatus xmlns:d="DAV:">${item(root)}` +
      item(`${root}vol/`, '<d:resourcetype><d:collection/></d:resourcetype><d:getlastmodified>Wed, 21 Oct 2026 13:00:00 GMT</d:getlastmodified>') +
      item(`${root}1.cbz`, '<d:getcontentlength>12</d:getcontentlength><d:getlastmodified>Wed, 21 Oct 2026 13:00:00 GMT</d:getlastmodified>') +
      item(`${root}2.cbz`, '<d:getcontentlength>3</d:getcontentlength><d:getlastmodified>not-a-date</d:getlastmodified>') +
      `</d:multistatus>`
    const result = parseWebDavListing(xml, new URL(base).href, 'root')
    expect(result[0].mtime).toBe(Date.parse('Wed, 21 Oct 2026 13:00:00 GMT'))
    expect(result[1].mtime).toBe(Date.parse('Wed, 21 Oct 2026 13:00:00 GMT'))
    expect(result[2].mtime).toBeUndefined()
  })

  it('拒绝跨站、编码后的上级跳转和反斜杠', () => {
    for (const path of [
      '../escape',
      '%2e%2e/escape',
      'https://evil.example/book',
      'folder%5c..%5csecret',
      '/outside/1.png'
    ])
      expect(() =>
        resourceUrl('https://nas.example/dav/', Buffer.from(path).toString('base64url'))
      ).toThrow()
  })
  it('不依赖 Content-Length 的响应体上限', async () => {
    expect(await limitedText(new Response('漫画'), 10)).toBe('漫画')
    await expect(limitedText(new Response('0123456789'), 5)).rejects.toThrow('响应过大')
  })
  it('HTTP 207 中的失败属性不能伪装成连接成功', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/</d:href><d:propstat><d:status>HTTP/1.1 403 Forbidden</d:status><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>',
            { status: 207 }
          )
      )
    )
    await expect(
      addWebDav({ name: '错误连接', url: 'https://nas.example/dav/', username: 'u', password: 'p' })
    ).rejects.toThrow('不是可访问的目录')
  })
})

describe('WebDAV 连接 / 挂载 / 凭据编辑', () => {
  const dav = 'https://nas.example/dav/'
  const collectionXml = (pathname: string): string =>
    `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>${pathname}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>`
  const listingXml = (pathname: string): string =>
    `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>${pathname}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response><d:response><d:href>${pathname}%E7%AC%AC1%E5%8D%B7/</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response><d:response><d:href>${pathname}1.cbz</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:getcontentlength>12</d:getcontentlength></d:prop></d:propstat></d:response></d:multistatus>`
  /** Depth:0 回集合自描述，Depth:1 回「第1卷 + 1.cbz」两条目 */
  const stubDav = (): ReturnType<typeof vi.fn> =>
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const headers = (init?.headers ?? {}) as Record<string, string>
      return new Response(headers.Depth === '0' ? collectionXml(url.pathname) : listingXml(url.pathname), {
        status: 207
      })
    })

  beforeEach(() => {
    vi.mocked(getSetting).mockReset()
    vi.mocked(setSetting).mockReset()
    vi.mocked(addLibrary).mockClear()
    vi.mocked(renameLibrary).mockClear()
    vi.mocked(updateLibraryPath).mockClear()
  })

  it('挂载浏览选中的子目录：连接身份按子目录地址计算，配置存的也是子目录', async () => {
    vi.stubGlobal('fetch', stubDav())
    const rootId = Buffer.from('漫画/第01卷/', 'utf8').toString('base64url')
    await addWebDav({ name: '  第01卷  ', url: dav, username: 'u', password: 'p', rootId })
    const mountUrl = new URL('漫画/第01卷/', dav).href
    expect(vi.mocked(addLibrary).mock.calls[0]).toEqual([
      '第01卷',
      `webdav://${webdavMountIdentity(mountUrl, 'u')}`,
      'webdav'
    ])
    expect(vi.mocked(setSetting).mock.calls[0][1]).toMatchObject({
      url: mountUrl,
      username: 'u'
    })
  })

  it('缺省 rootId 时挂载连接地址本身', async () => {
    vi.stubGlobal('fetch', stubDav())
    await addWebDav({ name: '根', url: dav, username: 'u', password: 'p' })
    expect(vi.mocked(addLibrary).mock.calls[0][1]).toBe(
      `webdav://${webdavMountIdentity(dav, 'u')}`
    )
  })

  it('连接身份：地址或用户名任一变化即变化，否则稳定', () => {
    expect(webdavMountIdentity('https://a/', 'u')).toBe(webdavMountIdentity('https://a/', 'u'))
    expect(webdavMountIdentity('https://a/', 'u')).not.toBe(webdavMountIdentity('https://a/x/', 'u'))
    expect(webdavMountIdentity('https://a/', 'u')).not.toBe(webdavMountIdentity('https://a/', 'v'))
  })

  it('webdavProbe：先验证集合可达，再列出根目录条目', async () => {
    const fetchMock = stubDav()
    vi.stubGlobal('fetch', fetchMock)
    const entries = await webdavProbe({ url: dav, username: 'u', password: 'p' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(entries.map((e) => [e.name, e.isDir, e.size])).toEqual([
      ['第1卷', true, 0],
      ['1.cbz', false, 12]
    ])
  })

  it('改密码不删库：新密码加密落盘，地址与用户名不变则身份不变', async () => {
    vi.stubGlobal('fetch', stubDav())
    vi.mocked(getSetting).mockReturnValue({ url: dav, username: 'u', password: 'plain:v1:old' })
    await updateWebDav(7, { password: 'new' })
    expect(vi.mocked(setSetting).mock.calls[0][1]).toMatchObject({
      url: dav,
      username: 'u',
      password: 'plain:v1:new'
    })
    expect(vi.mocked(updateLibraryPath)).toHaveBeenCalledWith(
      7,
      `webdav://${webdavMountIdentity(dav, 'u')}`
    )
    expect(vi.mocked(renameLibrary)).not.toHaveBeenCalled()
  })

  it('密码留空表示保持原密码', async () => {
    vi.stubGlobal('fetch', stubDav())
    vi.mocked(getSetting).mockReturnValue({ url: dav, username: 'u', password: 'plain:v1:old' })
    await updateWebDav(7, {})
    expect(vi.mocked(setSetting).mock.calls[0][1]).toMatchObject({
      password: 'plain:v1:old'
    })
  })

  it('改地址换身份并改名', async () => {
    vi.stubGlobal('fetch', stubDav())
    vi.mocked(getSetting).mockReturnValue({ url: dav, username: 'u', password: 'plain:v1:old' })
    await updateWebDav(7, { name: '新名', url: 'https://nas2.example/books/' })
    expect(vi.mocked(setSetting).mock.calls[0][1]).toMatchObject({
      url: 'https://nas2.example/books/'
    })
    expect(vi.mocked(updateLibraryPath).mock.calls[0][1]).toBe(
      `webdav://${webdavMountIdentity('https://nas2.example/books/', 'u')}`
    )
    expect(vi.mocked(renameLibrary)).toHaveBeenCalledWith(7, '新名')
  })
})
