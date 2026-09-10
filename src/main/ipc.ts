import { dialog, ipcMain } from 'electron'
import { readFile } from 'fs/promises'
import {
  addLibrary,
  chaptersBySeries,
  continueReading,
  getChapter,
  getLibrary,
  getProgress,
  getSeries,
  libraryArtifacts,
  setSeriesHidden,
  listLibraries,
  listSeries,
  recentlyAdded,
  removeLibrary,
  saveProgress,
  setLibraryCloudMeta,
  updateChapterPageCount,
  type LibraryRow
} from './db'
import { scanLibrary, type ScanSummary } from './scanner'
import { scanCloudLibrary } from './cloud189/scanner'
import {
  cloudCapacity,
  cloudFamilies,
  cloudListAll,
  cloudLogin,
  cloudLogout,
  cloudRestore,
  cloudStatus
} from './cloud189/client'
import { cacheStats } from './cloud189/cache'
import {
  clearAllCache,
  clearLibraryCache,
  clearSeriesCache,
  seriesCacheSizes
} from './cloud189/cacheManage'
import { ensureLocalChapterPath } from './cloud189/ensure'
import type { ReaderPrefs } from '../shared/types'
import { getSetting, setSetting } from './settings'
import { broadcast } from './events'
import { removeSeriesArtifacts } from './thumbnail'
import { longPath } from './util/paths'

let scanning = false

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 扫描入口。终态事件在此统一广播：
 *  - 成功 → scan:progress phase=done
 *  - 失败 → scan:notice level=error + phase=done
 * 保证渲染层的扫描浮标一定能收尾（此前失败时浮标会永久卡在屏幕上）。
 */
async function rescanLibrary(
  libraryId: number
): Promise<ScanSummary | { series: number; chapters: number }> {
  if (scanning) throw new Error('已有扫描任务在进行中')
  const lib = getLibrary(libraryId)
  if (!lib) throw new Error(`书库不存在：${libraryId}`)
  scanning = true
  try {
    const summary =
      lib.kind === 'cloud189'
        ? await scanCloudLibrary(
            libraryId,
            lib.cloud_folder_id ?? '-11',
            lib.family_id ?? undefined,
            (p) => broadcast('scan:progress', { ...p, phase: 'reading' })
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
    scanning = false
    broadcast('scan:progress', { libraryId, phase: 'done' })
  }
}

export function registerIpc(): void {
  ipcMain.handle('libraries:list', () => listLibraries())

  ipcMain.handle('libraries:add', async (): Promise<LibraryRow | null> => {
    const result = await dialog.showOpenDialog({
      title: '选择漫画库文件夹',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const path = result.filePaths[0]
    const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path
    const lib = addLibrary(name, path)
    void rescanLibrary(lib.id).catch(() => {})
    return lib
  })

  ipcMain.handle('libraries:remove', async (_e, id: number) => {
    const lib = getLibrary(id)
    if (!lib) return
    if (scanning) throw new Error('已有扫描任务在进行中，请等扫描结束后再删除')
    // 先取产物清单：删除后章节行会被级联清掉，就查不到了
    const artifacts = libraryArtifacts(id)
    // 云端书库：章节行随删除级联消失，先清掉它们的缓存产物
    if (lib.kind === 'cloud189') await clearLibraryCache(id)
    removeLibrary(id)
    await removeSeriesArtifacts(artifacts.seriesIds, artifacts.chapterIds)
  })

  ipcMain.handle('libraries:rescan', (_e, id: number) => rescanLibrary(id))

  // 移出书架：不删行，打 hidden 标记（扫描不复活；重扫中拒绝操作防状态错乱）
  ipcMain.handle('series:remove', (_e, id: number) => {
    if (scanning) throw new Error('已有扫描任务在进行中，请等扫描结束后再移出')
    if (!getSeries(id)) throw new Error(`系列不存在：${id}`)
    setSeriesHidden(id, true)
  })

  ipcMain.handle(
    'series:list',
    (_e, opts: { libraryId?: number; query?: string; filter?: string; limit?: number; offset?: number }) =>
      listSeries({
        libraryId: opts.libraryId,
        query: opts.query,
        filter: (opts.filter as 'all' | 'unread' | 'reading' | 'recent') ?? 'all',
        limit: opts.limit,
        offset: opts.offset
      })
  )

  ipcMain.handle('series:get', (_e, id: number) => {
    const series = getSeries(id)
    if (!series) return null
    return { series, chapters: chaptersBySeries(id) }
  })

  ipcMain.handle('home:continue', () => continueReading(12))
  ipcMain.handle('home:recent', () => recentlyAdded(12))

  ipcMain.handle('reader:chapter', (_e, chapterId: number) => {
    const chapter = getChapter(chapterId)
    if (!chapter) return null
    const [progress] = getProgress([chapterId])
    return { chapter, progress: progress ?? null }
  })

  // PDF 渲染用：经 IPC 返回原始字节（自定义协议的 fetch 在 Electron 下不可靠）
  ipcMain.handle('reader:file', async (_e, chapterId: number) => {
    const chapter = getChapter(chapterId)
    if (!chapter) return null
    // 云端压缩包/PDF：未缓存时先整包下载
    const path = await ensureLocalChapterPath(chapterId)
    return readFile(longPath(path))
  })

  // PDF 页数由渲染进程 pdfjs 统计后回填（主进程驱动层不支持 PDF）
  ipcMain.handle(
    'reader:setPageCount',
    (_e, payload: { chapterId: number; pageCount: number }): boolean => {
      const chapter = getChapter(payload.chapterId)
      const count = Math.floor(Number(payload.pageCount))
      if (!chapter || chapter.kind !== 'pdf' || !Number.isFinite(count) || count <= 0) return false
      if (chapter.page_count === count) return false
      updateChapterPageCount(payload.chapterId, count)
      return true
    }
  )

  ipcMain.handle(
    'progress:save',
    (_e, payload: { chapterId: number; page: number; completed?: boolean }) => {
      saveProgress(payload.chapterId, payload.page, payload.completed ?? false)
      return true
    }
  )

  ipcMain.handle('reader:prefs:get', (_e, seriesId: number): ReaderPrefs => {
    return getSetting<Record<string, ReaderPrefs>>('readerPrefs', {})[String(seriesId)] ?? {}
  })

  ipcMain.handle(
    'reader:prefs:set',
    (_e, payload: { seriesId: number; prefs: ReaderPrefs }): ReaderPrefs => {
      const all = getSetting<Record<string, ReaderPrefs>>('readerPrefs', {})
      const merged = { ...all[String(payload.seriesId)], ...payload.prefs }
      all[String(payload.seriesId)] = merged
      setSetting('readerPrefs', all)
      return merged
    }
  )

  // ---------- 天翼云盘 ----------

  ipcMain.handle('cloud:status', () => cloudStatus())

  ipcMain.handle('cloud:login', (_e, payload: { username: string; password: string }) =>
    cloudLogin(payload.username, payload.password).then(() => cloudStatus())
  )

  ipcMain.handle('cloud:logout', () => {
    cloudLogout()
    return cloudStatus()
  })

  ipcMain.handle('cloud:capacity', (_e, familyId?: string) => cloudCapacity(familyId || undefined))

  ipcMain.handle('cloud:families', () => cloudFamilies())

  ipcMain.handle('cloud:cacheStats', () => cacheStats())

  ipcMain.handle('cloud:cacheConfig:get', () => getSetting<number>('cloudCacheCapMb', 20 * 1024))
  ipcMain.handle('cloud:cacheConfig:set', (_e, capMb: number) => {
    const v = Math.max(1, Math.min(200 * 1024, Math.round(Number(capMb) || 20 * 1024)))
    setSetting('cloudCacheCapMb', v)
    return v
  })
  ipcMain.handle('cloud:cacheBySeries', () => seriesCacheSizes())
  ipcMain.handle('cloud:cacheClearAll', async () => ({ bytes: await clearAllCache() }))
  ipcMain.handle('cloud:cacheClearSeries', async (_e, seriesId: number) => ({
    bytes: await clearSeriesCache(seriesId)
  }))

  ipcMain.handle(
    'cloud:browse',
    async (_e, payload: { folderId?: string; familyId?: string }) => {
      const entries = await cloudListAll(payload.folderId ?? '-11', payload.familyId || undefined)
      return {
        folders: entries.filter((e) => e.isDir).map((e) => ({ id: e.id, name: e.name })),
        files: entries
          .filter((e) => !e.isDir)
          .map((e) => ({ id: e.id, name: e.name, size: e.size }))
      }
    }
  )

  ipcMain.handle(
    'cloud:addLibrary',
    async (_e, payload: { folderId: string; familyId?: string; name: string }) => {
      const lib = addLibrary(payload.name, `cloud189://${payload.folderId}`, 'cloud189')
      setLibraryCloudMeta(lib.id, payload.folderId, payload.familyId ?? null)
      void rescanLibrary(lib.id).catch(() => {})
      return lib
    }
  )

  // 启动时尝试恢复云盘会话
  void cloudRestore().catch(() => {})
}
