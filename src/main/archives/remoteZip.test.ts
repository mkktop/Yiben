import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import { createServer, type Server } from 'http'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { path7za } from '7zip-bin'
import { RemoteZip, RangeUnsupportedError, rangeFetch } from './remoteZip'

/** 用 7za 打包一个测试 zip：store=true 不压缩，覆盖两种压缩方法 */
function makeZip(dir: string, files: Array<[string, Buffer]>, store = false): Buffer {
  for (const [name, buf] of files) writeFileSync(join(dir, name), buf)
  const out = join(dir, `t${store ? '-store' : ''}.zip`)
  execFileSync(path7za, ['a', '-tzip', ...(store ? ['-mx=0'] : []), out, join(dir, '*.png')], {
    stdio: 'ignore'
  })
  return readFileSync(out)
}

const servers: Server[] = []

/** 支持 Range 的静态服务器（206 + Content-Range）；ignoreRange=true 时无视 Range 永远回 200 整包 */
async function serve(
  buf: Buffer,
  ignoreRange = false
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const m = req.headers.range?.match(/bytes=(\d+)-(\d*)/)
    const start = m ? Number(m[1]) : 0
    const end = m && m[2] ? Number(m[2]) : buf.length - 1
    const slice = buf.subarray(start, end + 1)
    if (m && !ignoreRange) {
      res.writeHead(206, {
        'content-type': 'application/octet-stream',
        'content-length': String(slice.length),
        'content-range': `bytes ${start}-${end}/${buf.length}`,
        'accept-ranges': 'bytes'
      })
    } else {
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(slice.length)
      })
    }
    res.end(slice)
  })
  servers.push(server)
  await new Promise<void>((r) => server.listen(0, r))
  const port = (server.address() as { port: number }).port
  return {
    url: `http://127.0.0.1:${port}/f.zip`,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((r) => server.close(() => r()))
    }
  }
}

describe('RemoteZip（HTTP Range 直读 zip）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yudu-rzip-'))
  const page1 = Buffer.from('第一页内容-' + 'x'.repeat(5000))
  const page2 = Buffer.from('y'.repeat(120000) + '-第二页')
  let deflateZip: Buffer
  let storeZip: Buffer

  beforeAll(() => {
    deflateZip = makeZip(dir, [['002.png', page2], ['001.png', page1]])
    storeZip = makeZip(dir, [['b.png', page2], ['a.png', page1]], true)
  })

  afterAll(async () => {
    for (const s of servers) {
      s.closeAllConnections()
      await new Promise<void>((r) => s.close(() => r()))
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('解析中央目录并按自然序列页（deflate）', async () => {
    const s = await serve(deflateZip)
    const zip = await RemoteZip.create(
      deflateZip.length,
      (a, b) => rangeFetch(s.url, a, b),
      async () => {}
    )
    expect(zip.pageCount).toBe(2)
    expect(zip.listPages().map((p) => p.name)).toEqual(['001.png', '002.png'])
    await s.close()
  })

  it('按需解压单页，字节与原文件一致（deflate + store）', async () => {
    const s = await serve(deflateZip)
    const zip = await RemoteZip.create(
      deflateZip.length,
      (a, b) => rangeFetch(s.url, a, b),
      async () => {}
    )
    expect(await zip.readPage(0)).toEqual(page1)
    expect(await zip.readPage(1)).toEqual(page2)
    await s.close()

    const s2 = await serve(storeZip)
    const zip2 = await RemoteZip.create(
      storeZip.length,
      (a, b) => rangeFetch(s2.url, a, b),
      async () => {}
    )
    expect(await zip2.readPage(0)).toEqual(page1)
    expect(await zip2.readPage(1)).toEqual(page2)
    await s2.close()
  })

  it('直链过期（403）时经 refresh 换链接重试成功', async () => {
    let token = 'v1'
    let rotated = 0
    let reqCount = 0
    const server = createServer((req, res) => {
      reqCount++
      const u = new URL(req.url ?? '/', 'http://x')
      if (u.searchParams.get('token') !== token) {
        res.writeHead(403)
        res.end()
        return
      }
      // create() 恰好发 2 个 Range 请求（尾部 + 中央目录）；
      // 第 3 个请求是首次 readPage 的本地头读取 —— 在这里 403 一次逼出 refresh 重试
      if (reqCount === 3) {
        res.writeHead(403)
        res.end()
        return
      }
      const m = req.headers.range?.match(/bytes=(\d+)-(\d*)/)
      const start = m ? Number(m[1]) : 0
      const end = m && m[2] ? Number(m[2]) : deflateZip.length - 1
      const slice = deflateZip.subarray(start, end + 1)
      res.writeHead(m ? 206 : 200, {
        'content-length': String(slice.length),
        ...(m ? { 'content-range': `bytes ${start}-${end}/${deflateZip.length}` } : {})
      })
      res.end(slice)
    })
    servers.push(server)
    await new Promise<void>((r) => server.listen(0, r))
    const port = (server.address() as { port: number }).port
    let url = `http://127.0.0.1:${port}/f.zip?token=${token}`
    const zip = await RemoteZip.create(
      deflateZip.length,
      (a, b) => rangeFetch(url, a, b),
      async () => {
        token = 'v2'
        rotated++
        url = `http://127.0.0.1:${port}/f.zip?token=${token}`
      }
    )
    const got = await zip.readPage(1)
    expect(got).toEqual(page2)
    expect(rotated).toBe(1)
    server.closeAllConnections()
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('服务器不支持 Range（无视头部返回 200）时明确报错', async () => {
    const s = await serve(deflateZip, true)
    await expect(
      RemoteZip.create(deflateZip.length, (a, b) => rangeFetch(s.url, a, b), async () => {})
    ).rejects.toThrow(RangeUnsupportedError)
    await s.close()
  })

  it('页码越界抛错', async () => {
    const s = await serve(deflateZip)
    const zip = await RemoteZip.create(
      deflateZip.length,
      (a, b) => rangeFetch(s.url, a, b),
      async () => {}
    )
    await expect(zip.readPage(9)).rejects.toThrow('页码越界')
    await s.close()
  })

  /** 篡改中央目录里某条目记录的未压缩 size 字段（zip bomb 模拟：谎报解压后大小） */
  function patchCdSize(buf: Buffer, name: string, size: number): Buffer {
    const out = Buffer.from(buf)
    // 从 EOCD 拿中央目录的真实起点（CD 前面还有本地文件头数据，不能从 0 扫）
    let eocd = -1
    for (let i = out.length - 22; i >= 0; i--) {
      if (out.readUInt32LE(i) === 0x06054b50) {
        eocd = i
        break
      }
    }
    let p = out.readUInt32LE(eocd + 16)
    while (p + 46 <= out.length && out.readUInt32LE(p) === 0x02014b50) {
      const nameLen = out.readUInt16LE(p + 28)
      if (out.toString('utf8', p + 46, p + 46 + nameLen) === name) {
        out.writeUInt32LE(size, p + 24)
        return out
      }
      p += 46 + nameLen + out.readUInt16LE(p + 30) + out.readUInt16LE(p + 32)
    }
    throw new Error(`中央目录里找不到 ${name}`)
  }

  it('zip bomb 防线：中央目录谎报超大 size 直接拒绝', async () => {
    const bomb = patchCdSize(deflateZip, '001.png', 0x10000000)
    const s = await serve(bomb)
    const zip = await RemoteZip.create(
      bomb.length,
      (a, b) => rangeFetch(s.url, a, b),
      async () => {}
    )
    await expect(zip.readPage(0)).rejects.toThrow('条目过大')
    await s.close()
  })

  it('zip bomb 防线：解压结果与声明的 size 不符时报长度不符（而不是返回错字节）', async () => {
    // 声明 size 在上限内但与真实解压结果不一致 → 校验拦截
    const lie = patchCdSize(deflateZip, '001.png', 999999)
    const s = await serve(lie)
    const zip = await RemoteZip.create(
      lie.length,
      (a, b) => rangeFetch(s.url, a, b),
      async () => {}
    )
    await expect(zip.readPage(0)).rejects.toThrow('条目长度不符')
    await s.close()
  })
})
