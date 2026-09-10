import { inflateRawSync } from 'node:zlib'
import { isImageFile, naturalCompare } from '../util/paths'
import type { PageEntry } from './types'

const EOCD_SIG = 0x06054b50
const EOCD64_LOCATOR_SIG = 0x07064b50
const EOCD64_SIG = 0x06064b50
const CD_SIG = 0x02014b50
const LFH_SIG = 0x04034b50

/** EOCD 最长 65557 字节（注释上限），一次拉尾部足够 */
const TAIL_BYTES = 66_000

export class RangeUnsupportedError extends Error {
  constructor() {
    super('直链不支持 Range 请求')
  }
}

interface RemoteEntry {
  name: string
  method: number
  compressedSize: number
  size: number
  /** 中央目录里记录的本地头偏移 */
  localOffset: number
}

/**
 * 通过 HTTP Range 直读云端 ZIP（CBZ）：
 * 只取中央目录 + 按需取单个 entry 的压缩字节，首屏不再需要整包下载。
 * 支持 store 与 deflate，基本 zip64（EOCD64 定位 + 大尺寸字段）。
 * 直链有时效：读到 403/410 时经 refresh() 换新链接重试一次。
 */
export class RemoteZip {
  private entries: RemoteEntry[] = []

  private constructor(
    private readonly size: number,
    private readonly fetchRange: (start: number, end: number) => Promise<Buffer>,
    private readonly refresh: () => Promise<void>
  ) {}

  static async create(
    expectedSize: number,
    fetchRange: (start: number, end: number) => Promise<Buffer>,
    refresh: () => Promise<void>
  ): Promise<RemoteZip> {
    if (expectedSize <= 0) throw new RangeUnsupportedError()
    const zip = new RemoteZip(expectedSize, fetchRange, refresh)
    await zip.parseCentralDirectory()
    return zip
  }

  private async parseCentralDirectory(): Promise<void> {
    const tailStart = Math.max(0, this.size - TAIL_BYTES)
    const tail = await this.fetchRange(tailStart, this.size - 1)

    // 从尾部向前找 EOCD 魔数
    let eocd = -1
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIG) {
        eocd = i
        break
      }
    }
    if (eocd === -1) throw new Error('ZIP 结构损坏：找不到 EOCD')

    let totalEntries = tail.readUInt16LE(eocd + 10)
    let cdSize = tail.readUInt32LE(eocd + 12)
    let cdOffset = tail.readUInt32LE(eocd + 16)

    // zip64：EOCD64 定位器紧贴在 EOCD 前
    if (
      (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) &&
      eocd >= 20 &&
      tail.readUInt32LE(eocd - 20) === EOCD64_LOCATOR_SIG
    ) {
      const eocd64Offset = Number(tail.readBigUInt64LE(eocd - 20 + 8))
      const eocd64 = await this.fetchRange(eocd64Offset, eocd64Offset + 56 - 1)
      if (eocd64.readUInt32LE(0) !== EOCD64_SIG) throw new Error('ZIP64 EOCD 魔数不符')
      totalEntries = Number(eocd64.readBigUInt64LE(32))
      cdSize = Number(eocd64.readBigUInt64LE(40))
      cdOffset = Number(eocd64.readBigUInt64LE(48))
    }

    const cd = await this.fetchRange(cdOffset, cdOffset + cdSize - 1)
    const entries: RemoteEntry[] = []
    let p = 0
    while (p + 46 <= cd.length && cd.readUInt32LE(p) === CD_SIG) {
      const flags = cd.readUInt16LE(p + 8)
      const method = cd.readUInt16LE(p + 10)
      let compressedSize = cd.readUInt32LE(p + 20)
      let size = cd.readUInt32LE(p + 24)
      const nameLen = cd.readUInt16LE(p + 28)
      const extraLen = cd.readUInt16LE(p + 30)
      const commentLen = cd.readUInt16LE(p + 32)
      let localOffset = cd.readUInt32LE(p + 42)
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen)
      const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen)

      // zip64 扩展字段：按 0xFFFFFFFF 占位出现顺序解析
      if (size === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff) {
        let q = 0
        while (q + 4 <= extra.length) {
          const head = extra.readUInt16LE(q)
          const headSize = extra.readUInt16LE(q + 2)
          if (head === 0x0001) {
            let r = q + 4
            if (size === 0xffffffff && r + 8 <= q + 4 + headSize) {
              size = Number(extra.readBigUInt64LE(r))
              r += 8
            }
            if (compressedSize === 0xffffffff && r + 8 <= q + 4 + headSize) {
              compressedSize = Number(extra.readBigUInt64LE(r))
              r += 8
            }
            if (localOffset === 0xffffffff && r + 8 <= q + 4 + headSize) {
              localOffset = Number(extra.readBigUInt64LE(r))
            }
            break
          }
          q += 4 + headSize
        }
      }

      // 加密条目（flags bit 0）读不了，跳过
      if (!(flags & 0x1) && isImageFile(name)) {
        entries.push({ name, method, compressedSize, size, localOffset })
      }
      p += 46 + nameLen + extraLen + commentLen
    }

    entries.sort((a, b) => naturalCompare(a.name, b.name))
    this.entries = entries
  }

  listPages(): PageEntry[] {
    return this.entries.map((e) => ({ name: e.name, size: e.size }))
  }

  get pageCount(): number {
    return this.entries.length
  }

  async readPage(index: number): Promise<Buffer> {
    const entry = this.entries[index]
    if (!entry) throw new Error(`页码越界：${index}`)
    try {
      return await this.readEntry(entry)
    } catch (err) {
      // 直链过期（403/410/401）：换链接重试一次
      if (isAuthError(err)) {
        await this.refresh()
        return this.readEntry(entry)
      }
      throw err
    }
  }

  private async readEntry(entry: RemoteEntry): Promise<Buffer> {
    // 本地文件头：名字长度在 +26，扩展长度在 +28（本地扩展与中央目录的可能不同）
    const lfh = await this.fetchRange(entry.localOffset, entry.localOffset + 29)
    if (lfh.readUInt32LE(0) !== LFH_SIG) throw new Error(`本地头魔数不符：${entry.name}`)
    const dataStart = entry.localOffset + 30 + lfh.readUInt16LE(26) + lfh.readUInt16LE(28)
    const raw = await this.fetchRange(dataStart, dataStart + entry.compressedSize - 1)
    if (entry.method === 0) return raw
    if (entry.method === 8) return inflateRawSync(raw)
    throw new Error(`不支持的压缩方法 ${entry.method}：${entry.name}`)
  }

  async close(): Promise<void> {}
}

function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /\b403\b|\b410\b|\b401\b/.test(msg)
}

/** 单次 Range 读：校验 206、截准字节数 */
export async function rangeFetch(url: string, start: number, end: number): Promise<Buffer> {
  const resp = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } })
  if (resp.status === 200 && start > 0) {
    // 服务器无视 Range 头返回了整文件 → 视为不支持
    throw new RangeUnsupportedError()
  }
  if (!resp.ok || !resp.body) {
    throw new Error(`Range 请求失败：HTTP ${resp.status}`)
  }
  const expected = end - start + 1
  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of resp.body as unknown as AsyncIterable<Uint8Array>) {
    const buf = Buffer.from(chunk)
    chunks.push(buf)
    received += buf.length
    if (received >= expected) break
  }
  return Buffer.concat(chunks).subarray(0, Math.min(received, expected))
}
