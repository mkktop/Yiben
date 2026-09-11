import { open } from 'fs/promises'
import type { DriverKind } from './types'
import { longPath } from '../util/paths'

/**
 * 魔数嗅探兜底：下载站转包常把 zip 存成 .cbr（或反之），按扩展名分派会直接开包失败。
 * 读文件头 8 字节识别真实容器；识别不出或读取失败时原样返回扩展名 kind。
 */
const MAGIC_RULES: Array<{ bytes: number[]; kind: DriverKind }> = [
  // PK\x03\x04（本地头）/ PK\x05\x06（空包）/ PK\x07\x08（分卷）
  { bytes: [0x50, 0x4b, 0x03, 0x04], kind: 'zip' },
  { bytes: [0x50, 0x4b, 0x05, 0x06], kind: 'zip' },
  { bytes: [0x50, 0x4b, 0x07, 0x08], kind: 'zip' },
  // Rar!\x1a\x07（RAR4 与 RAR5 同头）
  { bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07], kind: 'rar' },
  // 7z\xBC\xAF'\x1C
  { bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], kind: '7z' },
  // %PDF-
  { bytes: [0x25, 0x50, 0x44, 0x46, 0x2d], kind: 'pdf' }
]

async function readMagic(path: string): Promise<Buffer | null> {
  let fh: Awaited<ReturnType<typeof open>> | null = null
  try {
    fh = await open(longPath(path), 'r')
    const { buffer, bytesRead } = await fh.read(Buffer.alloc(8), 0, 8, 0)
    return bytesRead > 0 ? buffer.subarray(0, bytesRead) : null
  } catch {
    return null
  } finally {
    await fh?.close().catch(() => {})
  }
}

function match(buf: Buffer): DriverKind | null {
  for (const rule of MAGIC_RULES) {
    if (rule.bytes.every((b, i) => buf[i] === b)) return rule.kind
  }
  return null
}

/**
 * 返回实际应使用的驱动 kind：
 *  - 魔数与扩展名一致（或嗅探失败）→ 扩展名 kind
 *  - 不一致 → 采纳魔数 kind；唯一例外是 epub：EPUB 本质就是 zip 容器，
 *    嗅出的 zip 对它不是「伪装」而是常态，必须保持 epub 走 OPF 解析。
 */
export async function sniffArchiveKind(
  path: string,
  extKind: DriverKind | null
): Promise<DriverKind | null> {
  const buf = await readMagic(path)
  if (!buf) return extKind
  const sniffed = match(buf)
  if (!sniffed || sniffed === extKind) return extKind
  if (extKind === 'epub' && sniffed === 'zip') return 'epub'
  return sniffed
}
