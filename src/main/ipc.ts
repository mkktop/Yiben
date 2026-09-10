import { dialog, ipcMain } from 'electron'
import { readFile } from 'fs/promises'
import {
  addLibrary,
  bookmarksForSeries,
  chaptersBySeries,
  continueReading,
  getChapter,
  getLibrary,
  getProgress,
  getSeries,
  libraryArtifacts,
  listLibraries,
  listSeries,
  neighborChapters,
  recentlyAdded,
  removeLibrary,
  resetSeriesProgress,
  saveProgress,
  setChapterCompleted,
  setLibraryCloudMeta,
  setSeriesHidden,
  setSeriesHiddenMany,
  setSeriesProgress,
  toggleBookmark,
  updateChapterPageCount,
  updateSeriesMeta,
  rebuildFts,
  type LibraryRow,
  type SeriesMetaPatch
} from './db'
import { scanOneLocalSeries } from './scanner'
import { rescanLibrary, runExclusiveScan, isScanning } from './rescan'
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
import { cancelPrefetch, prefetchRunning, startPrefetch } from './cloud189/prefetch'
import { ensureLocalChapterPath } from './cloud189/ensure'
import { ensurePageDims } from './pageDims'
import { exportData, importData } from './dataTransfer'
import { startWatchers, stopWatchers } from './watcher'
import type { ReaderPrefs } from '../shared/types'
import { getSetting, setSetting } from './settings'
import { broadcast } from './events'
import { removeSeriesArtifacts } from './thumbnail'
import { longPath } from './util/paths'

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 渲染层可读写的应用配置键（白名单：settings 表里还有加密凭据等敏感键，不能开放） */
const CONFIG_KEYS = new Set(['readerDefaults', 'resumeOnLaunch', 'autoRescan'])

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
    if (isScanning()) throw new Error('已有扫描任务在进行中，请等扫描结束后再删除')
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
    if (isScanning()) throw new Error('已有扫描任务在进行中，请等扫描结束后再移出')
    if (!getSeries(id)) throw new Error(`系列不存在：${id}`)
    setSeriesHidden(id, true)
  })

  // 批量移出书架
  ipcMain.handle('series:removeMany', (_e, ids: number[]) => {
    if (isScanning()) throw new Error('已有扫描任务在进行中，请等扫描结束后再移出')
    setSeriesHiddenMany(Array.isArray(ids) ? ids.filter((n) => Number.isFinite(n)) : [])
    return true
  })

  ipcMain.handle(
    'series:list',
    (_e, opts: { libraryId?: number; query?: string; filter?: string; limit?: number; offset?: number }) =>
      listSeries({
        libraryId: opts.libraryId,
        query: opts.query,
        filter: opts.filter as 'all' | 'unread' | 'reading' | 'read' | 'recent',
        limit: opts.limit,
        offset: opts.offset
      })
  )

  ipcMain.handle('series:get', (_e, id: number) => {
    const series = getSeries(id)
    if (!series) return null
    const lib = getLibrary(series.library_id)
    return { series, chapters: chaptersBySeries(id), libraryKind: lib?.kind ?? 'local' }
  })

  // 手动编辑元数据（meta_edited=1，重扫不覆盖）
  ipcMain.handle('series:updateMeta', (_e, payload: { id: number; patch: SeriesMetaPatch }) => {
    if (!getSeries(payload.id)) throw new Error(`系列不存在：${payload.id}`)
    updateSeriesMeta(payload.id, payload.patch)
    rebuildFts()
    return getSeries(payload.id)
  })

  // 单系列重扫（仅本地库：云端没有按系列拉取的目录句柄）
  ipcMain.handle('series:rescan', async (_e, id: number) => {
    const series = getSeries(id)
    if (!series) throw new Error(`系列不存在：${id}`)
    const lib = getLibrary(series.library_id)
    if (!lib) throw new Error('所属书库不存在')
    if (lib.kind !== 'local') throw new Error('云端书库请使用书架页的「重新扫描」整库刷新')
    return runExclusiveScan(async () => {
      broadcast('scan:progress', { libraryId: lib.id, phase: 'reading', title: series.title })
      try {
        await scanOneLocalSeries(lib.id, {
          folder: series.folder_path,
          isSingleFile: series.is_single_file === 1
        })
        rebuildFts()
        return { ok: true }
      } catch (err) {
        broadcast('scan:notice', { libraryId: lib.id, level: 'error', message: errText(err) })
        throw err
      } finally {
        broadcast('scan:progress', { libraryId: lib.id, phase: 'done' })
      }
    })
  })

  // 标记整系列已读/未读、重置进度、单话勾选
  ipcMain.handle('series:markRead', (_e, payload: { id: number; read: boolean }) => {
    setSeriesProgress(payload.id, payload.read)
    return true
  })
  ipcMain.handle('series:resetProgress', (_e, id: number) => {
    resetSeriesProgress(id)
    return true
  })
  ipcMain.handle('progress:setCompleted', (_e, payload: { chapterId: number; completed: boolean }) => {
    setChapterCompleted(payload.chapterId, payload.completed)
    return true
  })

  ipcMain.handle('home:continue', () => continueReading(12))
  ipcMain.handle('home:recent', () => recentlyAdded(12))

  ipcMain.handle('reader:chapter', (_e, chapterId: number) => {
    const chapter = getChapter(chapterId)
    if (!chapter) return null
    const [progress] = getProgress([chapterId])
    return { chapter, progress: progress ?? null }
  })

  // 同系列前后话（阅读器跨话导航）
  ipcMain.handle('reader:neighbors', (_e, chapterId: number) => neighborChapters(chapterId))

  // 页尺寸：现有记录立即返回；缺的页在主进程后台探测，完成后经 chapter:pageDims 广播
  ipcMain.handle('reader:pageDims', (_e, chapterId: number) => ensurePageDims(chapterId))

  // 应用配置（白名单键）：阅读默认偏好、启动恢复、自动重扫
  ipcMain.handle('config:get', (_e, key: string) => {
    if (!CONFIG_KEYS.has(key)) throw new Error(`未知配置项：${key}`)
    return getSetting(key, undefined)
  })
  ipcMain.handle('config:set', (_e, payload: { key: string; value: unknown }) => {
    if (!CONFIG_KEYS.has(payload.key)) throw new Error(`未知配置项：${payload.key}`)
    setSetting(payload.key, payload.value)
    // 自动重扫开关即时生效
    if (payload.key === 'autoRescan') {
      if (payload.value === false) stopWatchers()
      else startWatchers()
    }
    return true
  })

  ipcMain.handle('reader:defaults:get', (): ReaderPrefs => getSetting('readerDefaults', {}))
  ipcMain.handle('reader:defaults:set', (_e, prefs: ReaderPrefs): ReaderPrefs => {
    const merged = { ...getSetting<ReaderPrefs>('readerDefaults', {}), ...prefs }
    setSetting('readerDefaults', merged)
    return merged
  })

  ipcMain.handle('bookmarks:toggle', (_e, payload: { chapterId: number; page: number }) =>
    toggleBookmark(payload.chapterId, payload.page)
  )
  ipcMain.handle('bookmarks:list', (_e, seriesId: number) => bookmarksForSeries(seriesId))

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

  // ---------- 数据导出/导入 ----------

  ipcMain.handle('data:export', () => exportData())
  ipcMain.handle('data:import', () => importData())

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

  // 整系列离线预取
  ipcMain.handle('cloud:prefetch', (_e, seriesId: number) => startPrefetch(seriesId))
  ipcMain.handle('cloud:prefetchCancel', (_e, seriesId: number) => cancelPrefetch(seriesId))
  ipcMain.handle('cloud:prefetchRunning', () => prefetchRunning())

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
