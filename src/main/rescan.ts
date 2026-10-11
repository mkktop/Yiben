import { getLibrary } from './db'
import { scanLibrary, type ScanSummary } from './scanner'
import { scanCloudLibrary } from './cloud189/scanner'
import { scan115Library } from './cloud115/scanner'
import { broadcast } from './events'
import { scanWebDavLibrary } from './webdav/scanner'

let scanning = false
const scanWaiters = new Set<() => void>()

/** 所有独占任务释放锁后通知排队任务，云端长扫描也不会因超时丢掉首扫。 */
function releaseScan(): void {
  scanning = false
  for (const resolve of scanWaiters) resolve()
  scanWaiters.clear()
}

export function isScanning(): boolean {
  return scanning
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 扫描入口。终态事件在此统一广播：
 *  - 成功 → scan:progress phase=done
 *  - 失败 → scan:notice level=error + phase=done
 * 保证渲染层的扫描浮标一定能收尾（此前失败时浮标会永久卡在屏幕上）。
 * IPC（手动重扫）、文件监听（自动重扫）共用这一个入口，互斥靠 scanning 标志。
 */
export async function rescanLibrary(
  libraryId: number
): Promise<ScanSummary | { series: number; chapters: number }> {
  if (scanning) throw new Error('已有扫描任务在进行中')
  const lib = getLibrary(libraryId)
  if (!lib) throw new Error(`书库不存在：${libraryId}`)
  scanning = true
  try {
    const summary =
      lib.kind === 'webdav'
        ? await scanWebDavLibrary(libraryId, (progress) => broadcast('scan:progress', progress))
        : lib.kind === 'cloud189'
          ? await scanCloudLibrary(
              libraryId,
              lib.cloud_folder_id ?? '-11',
              lib.family_id ?? undefined,
              (p) => broadcast('scan:progress', { ...p, phase: 'reading' })
            )
          : lib.kind === '115'
            ? await scan115Library(libraryId, lib.cloud_folder_id ?? '0', (p) =>
                broadcast('scan:progress', { ...p, phase: 'reading' })
              )
            : await scanLibrary(libraryId, (p) => {
                // 终态 done 交给 finally 统一发，避免两处重复或漏发
                if (p.phase !== 'done') broadcast('scan:progress', p)
              })

    if (summary.missing) {
      broadcast('scan:notice', {
        libraryId,
        level: 'warn',
        message: `有 ${summary.missing} 个系列在源目录里找不到了。它们的阅读进度已保留，重新挂载/改回目录后再扫描即可恢复。`
      })
    }
    return summary
  } catch (err) {
    broadcast('scan:notice', { libraryId, level: 'error', message: errText(err) })
    throw err
  } finally {
    releaseScan()
    broadcast('scan:progress', { libraryId, phase: 'done' })
  }
}

/** 自动重扫入口：失败只落日志（scan:notice 已广播给浮标），不向调用方抛错 */
export async function rescanQuietly(libraryId: number): Promise<void> {
  try {
    await rescanLibrary(libraryId)
  } catch (err) {
    console.warn(`[watcher] 自动重扫失败 library=${libraryId}:`, errText(err))
  }
}

/**
 * 添加书库后的自动首扫：此前是 fire-and-forget + 空 catch——恰有扫描在跑时
 * 直接被互斥挡掉且无任何提示，用户面对空库无从得知。这里排队等当前扫描
 * 结束再扫；同一书库的等待请求合并，扫描期间的新变化仍会追加一轮。
 */
let rescanQueue: Promise<void> = Promise.resolve()
const queuedLibraries = new Set<number>()
export function queueRescan(libraryId: number): Promise<void> {
  if (queuedLibraries.has(libraryId)) return rescanQueue
  queuedLibraries.add(libraryId)
  rescanQueue = rescanQueue
    .then(async () => {
      while (scanning) await new Promise<void>((resolve) => scanWaiters.add(resolve))
      queuedLibraries.delete(libraryId)
      // 等待期间书库可能已被移除，无需再报扫描失败。
      if (getLibrary(libraryId)) await rescanQuietly(libraryId)
    })
    .catch(() => {})
  return rescanQueue
}

/** 其他独占型扫描任务（单系列重扫）复用同一个互斥标志 */
export async function runExclusiveScan<T>(fn: () => Promise<T>, waitForTurn = false): Promise<T> {
  if (waitForTurn) while (scanning) await new Promise<void>((resolve) => scanWaiters.add(resolve))
  if (scanning) throw new Error('已有扫描任务在进行中')
  scanning = true
  try {
    return await fn()
  } finally {
    releaseScan()
  }
}
