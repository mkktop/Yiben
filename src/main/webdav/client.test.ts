import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => 'D:/test' } }))
import {
  normalizeWebDavUrl,
  resourceUrl,
  parseWebDavListing,
  limitedText,
  addWebDav
} from './client'
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
