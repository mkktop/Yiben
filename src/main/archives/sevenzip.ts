import { spawn } from 'child_process'
import { path7za } from '7zip-bin'
import { isImageFile, naturalCompare } from '../util/paths'
import type { ArchiveDriver, PageEntry } from './types'

function run7z(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(path7za, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString('utf8')
    })
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString('utf8')
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`7z 退出码 ${code}：${stderr.slice(0, 400)}`))
    })
  })
}

function run7zBinary(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(path7za, args, { windowsHide: true })
    const chunks: Buffer[] = []
    let stderr = ''
    child.stdout.on('data', (c: Buffer) => chunks.push(c))
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks))
      else reject(new Error(`7z 退出码 ${code}：${stderr.slice(0, 400)}`))
    })
  })
}

/**
 * 7Z / CB7 / TAR / CBT，经 7za 子进程实现。
 * 目录列表在首次打开时解析并缓存，单页用 `e -so` 输出到内存。
 */
export class SevenZipDriver implements ArchiveDriver {
  private names: string[] = []
  private sizes = new Map<string, number>()

  private constructor(private file: string) {}

  static async create(file: string): Promise<SevenZipDriver> {
    const driver = new SevenZipDriver(file)
    // 注意：7za 对 \\?\ 长路径前缀支持有 bug（会拒绝访问），这里必须用原始路径
    const out = await run7z(['l', '-ba', '-slt', file])

    // -slt 输出按空行分块，每块含 Path/Size/Folder 等字段
    const blocks = out.split(/\r?\n\r?\n/)
    const files: Array<{ path: string; size: number }> = []
    for (const block of blocks) {
      const pathLine = block.match(/^Path = (.+)$/m)
      if (!pathLine) continue
      const folderLine = block.match(/^Folder = (.+)$/m)
      if (folderLine && folderLine[1].trim() !== '-') continue
      const sizeLine = block.match(/^Size = (\d+)$/m)
      files.push({ path: pathLine[1].trim(), size: sizeLine ? Number(sizeLine[1]) : 0 })
    }

    driver.names = files
      .filter((f) => isImageFile(f.path))
      .sort((a, b) => naturalCompare(a.path, b.path))
      .map((f) => f.path)
    for (const f of files) driver.sizes.set(f.path, f.size)
    return driver
  }

  async listPages(): Promise<PageEntry[]> {
    return this.names.map((name) => ({ name, size: this.sizes.get(name) ?? 0 }))
  }

  async readPage(index: number): Promise<Buffer> {
    const name = this.names[index]
    if (!name) throw new Error(`页码越界：${index}`)
    // -so 输出到 stdout；-spd 禁用通配符转义，确保含特殊字符的路径原样匹配
    return run7zBinary(['e', '-so', '-spd', this.file, name])
  }

  async readEntry(name: string): Promise<Buffer | null> {
    try {
      return await run7zBinary(['e', '-so', '-spd', this.file, name])
    } catch {
      return null
    }
  }

  async close(): Promise<void> {}
}
