import {
  chaptersBySeries,
  getChapterPageFile,
  getLibrary,
  getSeries
} from '../db'
import { ensureChapterPage, ensureLocalChapterPath } from './ensure'
import { noteCloudError } from './client'
import { broadcast } from '../events'
import { existsSync } from 'fs'
import { longPath } from '../util/paths'
import { backoffDelay, chapterGapMs, sleep } from '../util/backoff'

export interface PrefetchProgress {
  seriesId: number
  /** 已完成的章节数 */
  done: number
  total: number
  chapterTitle: string
}

interface PrefetchTask {
  cancel: boolean
  /** 取消时 abort：进行中的整包下载经 AbortSignal 立即中断，不再占带宽和下载槽 */
  ctrl: AbortController
}

/** 每个系列同一时间只允许一个预取任务 */
const running = new Map<number, PrefetchTask>()

export function prefetchRunning(): number[] {
  return [...running.keys()]
}

/** 单章下载；瞬时失败按指数退避重试，仍失败返回章节标题（不中断整个系列） */
async function ensureChapterWithRetry(
  ch: { id: number; kind: string; page_count: number; path: string; title: string },
  task: PrefetchTask
): Promise<string | null> {
  const cancelled = (): boolean => task.cancel
  for (let attempt = 0; ; attempt++) {
    if (cancelled()) return null
    try {
      if (ch.kind === 'cfolder') {
        // 散图章节：逐页确保已缓存（页映射在扫描时已入库）
        for (let p = 0; p < Math.max(ch.page_count, 0); p++) {
          if (cancelled()) return null
          const page = getChapterPageFile(ch.id, p)
          if (!page) break
          await ensureChapterPage(ch.id, p, task.ctrl.signal)
        }
      } else {
        // 压缩包/PDF：整包下载
        if (!existsSync(longPath(ch.path))) {
          await ensureLocalChapterPath(ch.id, task.ctrl.signal)
        }
      }
      return null
    } catch (err) {
      if (cancelled()) return null
      // 会话失效重试无意义：交给 UI 引导重新登录，整体中止（含 115 的会话报错）
      const msg = err instanceof Error ? err.message : String(err)
      if (noteCloudError(err) === 'session' || /115 网盘未登录|115 网盘登录已失效|990001/.test(msg)) {
        throw err
      }
      if (attempt >= 2) return ch.title
      await sleep(backoffDelay(attempt))
    }
  }
}

/**
 * 整系列离线预取：把云端章节全部拉进本地缓存（散图按页、压缩包整包）。
 * 章节级串行 + 章节间 2–5 秒随机停顿（防风控），进度经 `prefetch:progress`
 * 广播，结束发 `prefetch:done`（重试后仍失败的章节记入 failed，不中断其余）。
 * 已在缓存里的章节自动跳过，重复点击安全。
 */
export function startPrefetch(seriesId: number): PrefetchProgress {
  if (running.has(seriesId)) throw new Error('该系列的离线缓存已在进行中')
  const series = getSeries(seriesId)
  if (!series) throw new Error(`系列不存在：${seriesId}`)
  const lib = getLibrary(series.library_id)
  if (lib?.kind === 'local') throw new Error('只有云端书库的漫画可以离线缓存')

  const chapters = chaptersBySeries(seriesId).filter(
    (c) => c.kind === 'cfolder' || c.cloud_file_id
  )
  if (chapters.length === 0) throw new Error('没有可缓存的云端章节')

  const task: PrefetchTask = { cancel: false, ctrl: new AbortController() }
  running.set(seriesId, task)
  const progress: PrefetchProgress = { seriesId, done: 0, total: chapters.length, chapterTitle: '' }
  broadcast('prefetch:progress', progress)

  void (async () => {
    const failed: string[] = []
    try {
      for (let i = 0; i < chapters.length; i++) {
        if (task.cancel) return
        const ch = chapters[i]
        progress.chapterTitle = ch.title
        broadcast('prefetch:progress', { ...progress })
        const bad = await ensureChapterWithRetry(ch, task)
        if (bad) failed.push(bad)
        progress.done = i + 1
        broadcast('prefetch:progress', { ...progress })
        // 章节间随机停顿，避免长时间不间断请求
        if (i < chapters.length - 1 && !task.cancel) await sleep(chapterGapMs())
      }
    } catch (err) {
      broadcast('prefetch:done', {
        seriesId,
        cancelled: false,
        error: err instanceof Error ? err.message : String(err),
        failed
      })
      return
    } finally {
      running.delete(seriesId)
    }
    broadcast('prefetch:done', { seriesId, cancelled: task.cancel, failed })
  })()

  return progress
}

export function cancelPrefetch(seriesId: number): boolean {
  const task = running.get(seriesId)
  if (!task) return false
  task.cancel = true
  // 进行中的下载也一并中断（整包下载可能还要跑几十秒到几分钟）
  task.ctrl.abort()
  return true
}
