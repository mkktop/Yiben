import { spawn } from 'child_process'
import { path7za } from '7zip-bin'
import { isImageFile, naturalCompare } from '../util/paths'
import { MAX_ARCHIVE_ENTRY_BYTES } from './types'
import type { ArchiveDriver, PageEntry } from './types'

/**
 * 子进程看护：stdin 必须关闭（加密包没传 -p 时 7za 会在 stdin 等密码，永久挂起
 * 并锁死全局扫描互斥）；stdout 必须封顶（zip bomb 解压无限膨胀）；必须有超时
 * （网络盘/坏盘 IO 挂起时同样卡死 worker）。
 */
const PROC_TIMEOUT_MS = 60_000

interface RunOptions {
  /** stdout 累计上限：超出立即 kill 并报错（防解压炸弹） */
  maxBytes?: number
}

function run7za(args: string[], opts: RunOptions = {}): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(path7za, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const chunks: Buffer[] = []
    let received = 0
    let stderr = ''
    let settled = false
    const finish = (err: Error | null, code = 0): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err) reject(err)
      else if (code === 0) resolve({ stdout: Buffer.concat(chunks), stderr })
      else reject(new Error(`7z 退出码 ${code}：${stderr.slice(0, 400)}`))
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(new Error(`7z 超时（${PROC_TIMEOUT_MS / 1000}s 无结果）`))
    }, PROC_TIMEOUT_MS)
    child.stdout.on('data', (c: Buffer) => {
      chunks.push(c)
      received += c.length
      if (opts.maxBytes !== undefined && received > opts.maxBytes) {
        child.kill()
        finish(new Error(`条目过大（已解压 ${received} 字节）`))
      }
    })
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')))
    child.on('error', (err) => finish(err))
    child.on('close', (code) => finish(null, code ?? -1))
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
    const { stdout } = await run7za(['l', '-ba', '-slt', '--', file], { maxBytes: 64 * 1024 * 1024 })

    // -slt 输出按空行分块，每块含 Path/Size/Folder 等字段
    const blocks = stdout.toString('utf8').split(/\r?\n\r?\n/)
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
      // 条目名会被 7za 当命令行解析：'-' 开头是开关、'@' 开头是 listfile，
      // 与压缩包外的文件系统语义冲突，一律不作为页处理
      .filter((f) => isImageFile(f.path) && !/^[-@]/.test(f.path))
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
    // -so 输出到 stdout；-spd 禁用通配符转义，确保含特殊字符的路径原样匹配；
    // -- 之后的参数不再被解析为开关
    const { stdout } = await run7za(['e', '-so', '-spd', '--', this.file, name], {
      maxBytes: MAX_ARCHIVE_ENTRY_BYTES
    })
    return stdout
  }

  async readEntry(name: string): Promise<Buffer | null> {
    if (/^[-@]/.test(name)) return null
    try {
      const { stdout } = await run7za(['e', '-so', '-spd', '--', this.file, name], {
        maxBytes: MAX_ARCHIVE_ENTRY_BYTES
      })
      return stdout
    } catch {
      return null
    }
  }

  async close(): Promise<void> {}
}
