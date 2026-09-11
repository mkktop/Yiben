import { readFile } from 'fs/promises'
import StreamZip from 'node-stream-zip'
import { isImageFile, joinPath, longPath, naturalCompare, readDirEntries } from '../util/paths'
import type { ArchiveDriver, PageEntry } from './types'

/** 散图文件夹 */
export class FolderDriver implements ArchiveDriver {
  private pages: PageEntry[] = []

  private constructor(private dir: string) {}

  static async create(dir: string): Promise<FolderDriver> {
    const driver = new FolderDriver(dir)
    const entries = await readDirEntries(dir)
    driver.pages = entries
      .filter((e) => !e.isDir && isImageFile(e.name))
      .sort((a, b) => naturalCompare(a.name, b.name))
      .map((e) => ({ name: e.name, size: 0 }))
    return driver
  }

  async listPages(): Promise<PageEntry[]> {
    return this.pages
  }

  async readPage(index: number): Promise<Buffer> {
    const page = this.pages[index]
    if (!page) throw new Error(`页码越界：${index}`)
    return readFile(longPath(joinPath(this.dir, page.name)))
  }

  async readEntry(name: string): Promise<Buffer | null> {
    try {
      return await readFile(longPath(joinPath(this.dir, name)))
    } catch {
      return null
    }
  }

  async close(): Promise<void> {}
}

/** ZIP / CBZ */
export class ZipDriver implements ArchiveDriver {
  private pages: PageEntry[] = []

  private constructor(private zip: StreamZip.StreamZipAsync) {}

  static async create(file: string): Promise<ZipDriver> {
    const zip = new StreamZip.async({ file: longPath(file), storeEntries: true })
    const driver = new ZipDriver(zip)
    const entries = await zip.entries()
    driver.pages = Object.values(entries)
      .filter((e) => !e.isDirectory && isImageFile(e.name))
      .sort((a, b) => naturalCompare(a.name, b.name))
      .map((e) => ({ name: e.name, size: e.size }))
    return driver
  }

  async listPages(): Promise<PageEntry[]> {
    return this.pages
  }

  async readPage(index: number): Promise<Buffer> {
    const page = this.pages[index]
    if (!page) throw new Error(`页码越界：${index}`)
    const data = await this.zip.entryData(page.name)
    return Buffer.from(data)
  }

  async readEntry(name: string): Promise<Buffer | null> {
    try {
      return Buffer.from(await this.zip.entryData(name))
    } catch {
      return null
    }
  }

  async close(): Promise<void> {
    await this.zip.close()
  }
}
