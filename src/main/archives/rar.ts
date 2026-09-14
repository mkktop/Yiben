import { readFile } from 'fs/promises'
import { createExtractorFromData } from 'node-unrar-js'
import { isImageFile, longPath, naturalCompare } from '../util/paths'
import { MAX_ARCHIVE_ENTRY_BYTES } from './types'
import type { ArchiveDriver, PageEntry } from './types'

type Extractor = Awaited<ReturnType<typeof createExtractorFromData>>

/**
 * RAR / CBR（含 RAR5）。
 * node-unrar-js 基于官方 unrar 源码的 wasm 编译，随机解压单页前需整包读入内存。
 */
export class RarDriver implements ArchiveDriver {
  private extractor!: Extractor
  private names: string[] = []
  private sizes = new Map<string, number>()

  static async create(file: string): Promise<RarDriver> {
    const driver = new RarDriver()
    const raw = await readFile(longPath(file))
    const data = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
    driver.extractor = await createExtractorFromData({ data })

    const list = driver.extractor.getFileList()
    const headers = [...list.fileHeaders]
    driver.names = headers
      .filter((h) => !h.flags.directory && isImageFile(h.name))
      .sort((a, b) => naturalCompare(a.name, b.name))
      .map((h) => h.name)
    for (const h of headers) driver.sizes.set(h.name, h.unpSize)
    return driver
  }

  async listPages(): Promise<PageEntry[]> {
    return this.names.map((name) => ({ name, size: this.sizes.get(name) ?? 0 }))
  }

  async readPage(index: number): Promise<Buffer> {
    const name = this.names[index]
    if (!name) throw new Error(`页码越界：${index}`)
    // 声明尺寸超限直接拒绝：wasm 解压同样没有增量上限，炸弹会整段膨胀
    if ((this.sizes.get(name) ?? 0) > MAX_ARCHIVE_ENTRY_BYTES) {
      throw new Error(`条目过大（${this.sizes.get(name)} 字节）：${name}`)
    }
    const extracted = this.extractor.extract({ files: [name] })
    const files = [...extracted.files]
    const file = files[0]
    if (!file?.extraction) throw new Error(`解压失败：${name}`)
    return Buffer.from(file.extraction)
  }

  async readEntry(name: string): Promise<Buffer | null> {
    try {
      if ((this.sizes.get(name) ?? 0) > MAX_ARCHIVE_ENTRY_BYTES) return null
      const file = [...this.extractor.extract({ files: [name] }).files][0]
      return file?.extraction ? Buffer.from(file.extraction) : null
    } catch {
      return null
    }
  }

  async close(): Promise<void> {}
}
