import { watch, type FSWatcher } from 'chokidar'
import { listLibraries } from './db'
import { queueRescan } from './rescan'
import { broadcast } from './events'

/**
 * 本地书库文件监听：增删/替换压缩包后自动增量重扫（去抖 5s）。
 * 云端书库没有文件系统事件，不监听。
 */
const watchers = new Map<number, FSWatcher>()
const timers = new Map<number, NodeJS.Timeout>()

export function startWatchers(): void {
  stopWatchers()
  for (const lib of listLibraries()) {
    if (lib.kind !== 'local') continue
    const watcher = watch(lib.path, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 200 },
      ignored: (p) => {
        // 跳过临时文件与隐藏文件，避免下载/解压中间态触发扫描
        const base = p.split(/[\\/]/).pop() ?? ''
        return base.startsWith('.') || base.endsWith('.part') || base.endsWith('.tmp')
      }
    })
    const schedule = (): void => {
      const prev = timers.get(lib.id)
      if (prev) clearTimeout(prev)
      timers.set(
        lib.id,
        setTimeout(() => {
          timers.delete(lib.id)
          void queueRescan(lib.id)
        }, 5000)
      )
    }
    watcher.on('add', schedule)
    watcher.on('unlink', schedule)
    watcher.on('addDir', schedule)
    watcher.on('unlinkDir', schedule)
    watcher.on('change', schedule)
    watcher.on('error', (err) => {
      broadcast('scan:notice', {
        libraryId: lib.id,
        level: 'warn',
        message: `书库文件监听失败，请手动重扫：${err instanceof Error ? err.message : String(err)}`
      })
    })
    watchers.set(lib.id, watcher)
  }
}

export function stopWatchers(): void {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  for (const w of watchers.values()) void w.close().catch(() => {})
  watchers.clear()
}
