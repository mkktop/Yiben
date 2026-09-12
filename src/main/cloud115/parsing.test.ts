import { describe, expect, it } from 'vitest'
import {
  buildCookieHeader,
  extractDownloadUrl,
  isRateLimitJson,
  isSessionErrorJson,
  mapQrStatus,
  parseListEntry,
  parseListResponse,
  parseLoginCookie,
  parseSpaceInfo,
  parseUsername,
  toNum
} from './parsing'

describe('toNum', () => {
  it('兼容字符串与数字两种口径', () => {
    expect(toNum(123)).toBe(123)
    expect(toNum('456')).toBe(456)
    expect(toNum('abc')).toBe(0)
    expect(toNum(undefined)).toBe(0)
    expect(toNum(null)).toBe(0)
  })
})

describe('parseListEntry', () => {
  it('文件项：id 取 pickcode，fid 有值为文件', () => {
    const e = parseListEntry({ fid: '319873', cid: 0, n: '第01话.zip', s: '1024', pc: '9pf8sr6a' })
    expect(e).toEqual({ id: '9pf8sr6a', name: '第01话.zip', size: 1024, isDir: false })
  })

  it('目录项：没有 fid，id 取 cid，size 恒 0；大 id 以字符串下发不受精度影响', () => {
    const e = parseListEntry({ cid: '249163533602609229', n: '海贼王', pc: null })
    expect(e).toEqual({ id: '249163533602609229', name: '海贼王', size: 0, isDir: true })
  })

  it('缺名称 / 缺 pickcode 的文件项跳过', () => {
    expect(parseListEntry({ fid: '1', cid: 0, pc: 'abc' })).toBeNull()
    expect(parseListEntry({ fid: '1', cid: 0, n: 'a.jpg' })).toBeNull()
  })
})

describe('parseListResponse', () => {
  it('state=false 抛出服务端错误', () => {
    expect(() =>
      parseListResponse({ state: false, error: '登录超时，请重新登录。', errNo: 990001 })
    ).toThrow('登录超时')
  })

  it('整包解析：目录在前文件在后由服务端决定，这里只按序透传', () => {
    const { entries, count } = parseListResponse({
      state: 1,
      count: '2',
      data: [
        { cid: 10, n: '卷一' },
        { fid: 'f1', cid: 10, n: '01.jpg', s: 5, pc: 'pc1' }
      ]
    })
    expect(count).toBe(2)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ isDir: true, id: '10' })
    expect(entries[1]).toMatchObject({ isDir: false, id: 'pc1', size: 5 })
  })
})

describe('mapQrStatus', () => {
  it('status 在 data.status（现行口径）', () => {
    expect(mapQrStatus({ state: 1, data: { status: 0 } })).toBe('waiting')
    expect(mapQrStatus({ state: 1, data: { status: 1 } })).toBe('scanned')
    expect(mapQrStatus({ state: 1, data: { status: 2 } })).toBe('allowed')
    expect(mapQrStatus({ state: 1, data: { status: -1 } })).toBe('expired')
    expect(mapQrStatus({ state: 1, data: { status: -2 } })).toBe('canceled')
  })

  it('旧口径顶层 status 与失效响应', () => {
    expect(mapQrStatus({ status: 1 })).toBe('scanned')
    expect(mapQrStatus({ state: 0, code: 40199002, message: 'key invalid', data: {} })).toBe('invalid')
  })
})

describe('parseLoginCookie', () => {
  it('提取 UID/CID/SEID/KID', () => {
    const cred = parseLoginCookie({
      state: 1,
      data: { cookie: { UID: 'u1', CID: 'c1', SEID: 's1', KID: 'k1' } }
    })
    expect(cred).toEqual({ uid: 'u1', cid: 'c1', seid: 's1', kid: 'k1' })
  })

  it('缺 SEID 视为失败', () => {
    expect(() => parseLoginCookie({ state: 1, data: { cookie: { UID: 'u', CID: 'c' } } })).toThrow()
  })
})

describe('buildCookieHeader', () => {
  it('分号分隔无空格，KID 可选', () => {
    expect(buildCookieHeader({ uid: 'u', cid: 'c', seid: 's' })).toBe('UID=u;CID=c;SEID=s')
    expect(buildCookieHeader({ uid: 'u', cid: 'c', seid: 's', kid: 'k' })).toBe('UID=u;CID=c;SEID=s;KID=k')
  })
})

describe('extractDownloadUrl', () => {
  it('url 对象形态（ SheltonZhu 115driver 口径）', () => {
    expect(extractDownloadUrl({ state: 1, url: { url: 'https://cdn.example.com/f' } })).toBe(
      'https://cdn.example.com/f'
    )
  })

  it('url 字符串形态与失败分支', () => {
    expect(extractDownloadUrl({ state: 1, url: 'https://cdn.example.com/f' })).toBe('https://cdn.example.com/f')
    expect(() => extractDownloadUrl({ state: false, error: '文件不存在' })).toThrow('文件不存在')
    expect(() => extractDownloadUrl({ state: 1, url: { url: 'false' } })).toThrow('缺少下载地址')
  })
})

describe('错误识别', () => {
  it('isSessionErrorJson：errNo 990001 或文案', () => {
    expect(isSessionErrorJson({ state: false, errNo: 990001, error: '登录超时，请重新登录。' })).toBe(true)
    expect(isSessionErrorJson({ state: 0, errno: 990001 })).toBe(true)
    expect(isSessionErrorJson({ state: false, error: '请先登录,后操作！' })).toBe(true)
    expect(isSessionErrorJson({ state: false, error: '参数错误。', errno: 990002 })).toBe(false)
    expect(isSessionErrorJson({ state: 1 })).toBe(false)
  })

  it('isRateLimitJson', () => {
    expect(isRateLimitJson({ errNo: 990007 })).toBe(true)
    expect(isRateLimitJson({ error: '您的操作太频繁了，请稍后再试' })).toBe(true)
    expect(isRateLimitJson({ error: '登录超时' })).toBe(false)
  })
})

describe('parseSpaceInfo', () => {
  it('提取总量与剩余', () => {
    const r = parseSpaceInfo({
      state: true,
      data: { space_info: { all_total: { size: 100 }, all_use: { size: '40' } } }
    })
    expect(r).toEqual({ total: 100, free: 60 })
  })

  it('结构缺失时返回 0', () => {
    expect(parseSpaceInfo({ state: true })).toEqual({ total: 0, free: 0 })
  })
})

describe('parseUsername', () => {
  it('兼容几种字段位置', () => {
    expect(parseUsername({ state: true, data: { user_name: '张三' } })).toBe('张三')
    expect(parseUsername({ state: true, data: { uname: 'li' } })).toBe('li')
    expect(parseUsername({ state: true, data: { userinfo: { user_name: 'ww' } } })).toBe('ww')
    expect(parseUsername({ state: true, data: {} })).toBeNull()
    expect(parseUsername({ state: false })).toBeNull()
  })
})
