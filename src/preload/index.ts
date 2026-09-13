import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  CloudBrowseResult,
  CloudNotice,
  DiagnoseReport,
  PrefetchDone,
  PrefetchProgress,
  ShelfInfo,
  TagInfo
} from '../shared/types'

const api = {
  appWindow: {
    minimize: (): Promise<void> => ipcRenderer.invoke('appWindow:minimize'),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('appWindow:toggleMaximize'),
    close: (): Promise<void> => ipcRenderer.invoke('appWindow:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('appWindow:isMaximized'),
    /** 无边框窗口的最大化状态（WindowControls 切图标用） */
    onMaximizeChange: (cb: (maximized: boolean) => void) => {
      const listener = (_e: unknown, maximized: boolean): void => cb(maximized)
      ipcRenderer.on('window:maximized', listener)
      return (): void => {
        ipcRenderer.removeListener('window:maximized', listener)
      }
    }
  },
  libraries: {
    list: () => ipcRenderer.invoke('libraries:list'),
    add: () => ipcRenderer.invoke('libraries:add'),
    remove: (id: number) => ipcRenderer.invoke('libraries:remove', id),
    rescan: (id: number) => ipcRenderer.invoke('libraries:rescan', id)
  },
  series: {
    list: (opts?: {
      libraryId?: number
      query?: string
      filter?: 'all' | 'unread' | 'reading' | 'read' | 'recent'
      /** 归入某虚拟书架 */
      shelfId?: number
      /** 自定义标签（关联表），多个 AND 语义 */
      tags?: string[]
      limit?: number
      offset?: number
    }) => ipcRenderer.invoke('series:list', opts ?? {}),
    get: (id: number) => ipcRenderer.invoke('series:get', id),
    remove: (id: number) => ipcRenderer.invoke('series:remove', id),
    removeMany: (ids: number[]) => ipcRenderer.invoke('series:removeMany', ids),
    updateMeta: (id: number, patch: Record<string, unknown>) =>
      ipcRenderer.invoke('series:updateMeta', { id, patch }),
    rescan: (id: number) => ipcRenderer.invoke('series:rescan', id),
    markRead: (id: number, read: boolean) =>
      ipcRenderer.invoke('series:markRead', { id, read }),
    resetProgress: (id: number) => ipcRenderer.invoke('series:resetProgress', id)
  },
  config: {
    get: (key: string) => ipcRenderer.invoke('config:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('config:set', { key, value })
  },
  bookmarks: {
    toggle: (chapterId: number, page: number) =>
      ipcRenderer.invoke('bookmarks:toggle', { chapterId, page }) as Promise<boolean>,
    list: (seriesId: number) => ipcRenderer.invoke('bookmarks:list', seriesId)
  },
  shelves: {
    list: (): Promise<ShelfInfo[]> => ipcRenderer.invoke('shelves:list') as Promise<ShelfInfo[]>,
    /** 同名创建幂等：返回已有书架 */
    create: (name: string): Promise<ShelfInfo> =>
      ipcRenderer.invoke('shelves:create', name) as Promise<ShelfInfo>,
    rename: (id: number, name: string): Promise<void> =>
      ipcRenderer.invoke('shelves:rename', { id, name }) as Promise<void>,
    remove: (id: number): Promise<void> =>
      ipcRenderer.invoke('shelves:remove', id) as Promise<void>,
    /** 系列当前归入的书架 id（弹层回显） */
    forSeries: (seriesId: number): Promise<number[]> =>
      ipcRenderer.invoke('shelves:forSeries', seriesId) as Promise<number[]>,
    /** 全量替换系列的书架归属（空数组 = 全部移出） */
    setForSeries: (seriesId: number, shelfIds: number[]): Promise<void> =>
      ipcRenderer.invoke('shelves:setForSeries', { seriesId, shelfIds }) as Promise<void>
  },
  tags: {
    list: (): Promise<TagInfo[]> => ipcRenderer.invoke('tags:list') as Promise<TagInfo[]>,
    /** 系列当前的自定义标签名（弹层回显） */
    forSeries: (seriesId: number): Promise<string[]> =>
      ipcRenderer.invoke('tags:forSeries', seriesId) as Promise<string[]>,
    /** 全量替换系列的自定义标签；不存在的 name 自动创建 */
    setForSeries: (seriesId: number, names: string[]): Promise<void> =>
      ipcRenderer.invoke('tags:setForSeries', { seriesId, names }) as Promise<void>
  },
  data: {
    export: () => ipcRenderer.invoke('data:export'),
    import: () => ipcRenderer.invoke('data:import')
  },
  diagnose: {
    /** 库体检（只读诊断）：损坏章节/空章节/重复系列/孤儿缩略图；可选限定某个书库 */
    run: (libraryId?: number): Promise<DiagnoseReport> =>
      ipcRenderer.invoke('diagnose:run', libraryId) as Promise<DiagnoseReport>
  },
  home: {
    continue: () => ipcRenderer.invoke('home:continue'),
    recent: () => ipcRenderer.invoke('home:recent')
  },
  stats: {
    /** 阅读统计（热力图/指标卡）：最近 days 天的每日页数与连续天数等 */
    overview: (days?: number) =>
      ipcRenderer.invoke('stats:overview', days) as Promise<{
        days: Array<{ day: string; pages: number }>
        streak: number
        totalPages: number
        totalDays: number
        bestDay: { day: string; pages: number } | null
      }>
  },
  updater: {
    appVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
    check: (): Promise<{
      status: 'dev' | 'busy' | 'available' | 'latest' | 'error'
      current: string
      version?: string
      notes?: string
      error?: string
    }> => ipcRenderer.invoke('app:check-update'),
    download: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('app:download-update'),
    install: (): Promise<void> => ipcRenderer.invoke('app:install-update'),
    /** renderer 重载后恢复：是否有已下载待安装的版本 */
    state: (): Promise<{ ready: string; downloading: boolean }> =>
      ipcRenderer.invoke('app:update-state'),
    onProgress: (cb: (percent: number) => void) => {
      const listener = (_e: unknown, percent: number): void => cb(percent)
      ipcRenderer.on('app:update-progress', listener)
      return (): void => {
        ipcRenderer.removeListener('app:update-progress', listener)
      }
    },
    onReady: (cb: (version: string) => void) => {
      const listener = (_e: unknown, version: string): void => cb(version)
      ipcRenderer.on('app:update-ready', listener)
      return (): void => {
        ipcRenderer.removeListener('app:update-ready', listener)
      }
    }
  },
  reader: {
    chapter: (chapterId: number) => ipcRenderer.invoke('reader:chapter', chapterId),
    /** 同系列前后话（末页自动进下一话 / 手动切换） */
    neighbors: (chapterId: number) =>
      ipcRenderer.invoke('reader:neighbors', chapterId) as Promise<{
        index: number
        total: number
        prev: { id: number; title: string; page_count: number; kind: string } | null
        next: { id: number; title: string; page_count: number; kind: string } | null
      } | null>,
    /** 页尺寸（双页跨页识别）：立即返回已知记录，缺的页主进程后台探测后经事件推送 */
    pageDims: (chapterId: number) =>
      ipcRenderer.invoke('reader:pageDims', chapterId) as Promise<{
        dims: Array<{ idx: number; w: number; h: number }>
        probing: boolean
      }>,
    file: (chapterId: number) => ipcRenderer.invoke('reader:file', chapterId),
    /** PDF 页数回填（渲染进程用 pdfjs 统计后写回主进程） */
    setPageCount: (chapterId: number, pageCount: number) =>
      ipcRenderer.invoke('reader:setPageCount', { chapterId, pageCount }) as Promise<boolean>,
    getPrefs: (seriesId: number) => ipcRenderer.invoke('reader:prefs:get', seriesId),
    setPrefs: (seriesId: number, prefs: {
      mode?: 'single' | 'double' | 'webtoon'
      fit?: 'width' | 'height' | 'original'
      rtl?: boolean
      rotate?: number
      spreadOffset?: 0 | 1
      zoom?: number
    }) => ipcRenderer.invoke('reader:prefs:set', { seriesId, prefs }),
    getDefaults: () => ipcRenderer.invoke('reader:defaults:get'),
    setDefaults: (prefs: {
      mode?: 'single' | 'double' | 'webtoon'
      fit?: 'width' | 'height' | 'original'
      rtl?: boolean
      rotate?: number
      spreadOffset?: 0 | 1
      zoom?: number
    }) => ipcRenderer.invoke('reader:defaults:set', prefs)
  },
  progress: {
    save: (chapterId: number, page: number, completed?: boolean) =>
      ipcRenderer.invoke('progress:save', { chapterId, page, completed }),
    setCompleted: (chapterId: number, completed: boolean) =>
      ipcRenderer.invoke('progress:setCompleted', { chapterId, completed })
  },
  openFile: {
    /** 领取冷启动暂存的待打开章节 id（没有则 null）；与 events.onOpenFile 的推送互补 */
    take: (): Promise<number | null> => ipcRenderer.invoke('app:takeOpenFile') as Promise<number | null>
  },
  events: {
    onScanProgress: (cb: (payload: unknown) => void) => {
      const listener = (_e: unknown, payload: unknown): void => cb(payload)
      ipcRenderer.on('scan:progress', listener)
      return (): void => {
        ipcRenderer.removeListener('scan:progress', listener)
      }
    },
    /** 扫描错误/告警（保证浮标能收尾，不再是静默失败） */
    onScanNotice: (cb: (payload: { level: 'error' | 'warn'; message: string }) => void) => {
      const listener = (_e: unknown, payload: { level: 'error' | 'warn'; message: string }): void =>
        cb(payload)
      ipcRenderer.on('scan:notice', listener)
      return (): void => {
        ipcRenderer.removeListener('scan:notice', listener)
      }
    },
    /** 章节页数回填（云端压缩包整包下载后主进程才知道真实页数） */
    onChapterPageCount: (cb: (payload: { chapterId: number; pageCount: number }) => void) => {
      const listener = (
        _e: unknown,
        payload: { chapterId: number; pageCount: number }
      ): void => cb(payload)
      ipcRenderer.on('chapter:pageCount', listener)
      return (): void => {
        ipcRenderer.removeListener('chapter:pageCount', listener)
      }
    },
    /** 页尺寸探测进度（双页模式跨页识别） */
    onChapterPageDims: (
      cb: (payload: { chapterId: number; dims: Array<{ idx: number; w: number; h: number }> }) => void
    ) => {
      const listener = (
        _e: unknown,
        payload: { chapterId: number; dims: Array<{ idx: number; w: number; h: number }> }
      ): void => cb(payload)
      ipcRenderer.on('chapter:pageDims', listener)
      return (): void => {
        ipcRenderer.removeListener('chapter:pageDims', listener)
      }
    },
    /** 离线预取进度 */
    onPrefetchProgress: (cb: (payload: PrefetchProgress) => void) => {
      const listener = (_e: unknown, payload: PrefetchProgress): void =>
        cb(payload)
      ipcRenderer.on('prefetch:progress', listener)
      return (): void => {
        ipcRenderer.removeListener('prefetch:progress', listener)
      }
    },
    onPrefetchDone: (cb: (payload: PrefetchDone) => void) => {
      const listener = (_e: unknown, payload: PrefetchDone): void =>
        cb(payload)
      ipcRenderer.on('prefetch:done', listener)
      return (): void => {
        ipcRenderer.removeListener('prefetch:done', listener)
      }
    },
    /** 云端风控/会话失效通知（阅读器/任意页面全局提示） */
    onCloudNotice: (cb: (payload: CloudNotice) => void) => {
      const listener = (_e: unknown, payload: CloudNotice): void => cb(payload)
      ipcRenderer.on('cloud:notice', listener)
      return (): void => {
        ipcRenderer.removeListener('cloud:notice', listener)
      }
    },
    /** 系统文件关联：主进程解析出双击文件的章节 id 后推送 */
    onOpenFile: (cb: (payload: { chapterId: number }) => void) => {
      const listener = (_e: unknown, payload: { chapterId: number }): void => cb(payload)
      ipcRenderer.on('app:openFile', listener)
      return (): void => {
        ipcRenderer.removeListener('app:openFile', listener)
      }
    }
  },
  cloud: {
    status: () => ipcRenderer.invoke('cloud:status'),
    login: (username: string, password: string) =>
      ipcRenderer.invoke('cloud:login', { username, password }),
    qr: {
      /** 发起扫码登录：返回官方渲染的二维码图片（dataURL） */
      start: (): Promise<{ dataUrl: string }> =>
        ipcRenderer.invoke('cloud:qrStart') as Promise<{ dataUrl: string }>,
      /** 轮询扫码状态：waiting 未扫码 / scanned 已扫码待确认 / done 成功 / expired 过期 */
      poll: (): Promise<{ state: 'waiting' | 'scanned' | 'done' | 'expired'; username?: string }> =>
        ipcRenderer.invoke('cloud:qrPoll') as Promise<{
          state: 'waiting' | 'scanned' | 'done' | 'expired'
          username?: string
        }>
    },
    logout: () => ipcRenderer.invoke('cloud:logout'),
    capacity: (familyId?: string) => ipcRenderer.invoke('cloud:capacity', familyId),
    families: () => ipcRenderer.invoke('cloud:families'),
    cacheStats: () => ipcRenderer.invoke('cloud:cacheStats'),
    cacheConfigGet: () => ipcRenderer.invoke('cloud:cacheConfig:get'),
    cacheConfigSet: (capMb: number) => ipcRenderer.invoke('cloud:cacheConfig:set', capMb),
    cacheBySeries: () =>
      ipcRenderer.invoke('cloud:cacheBySeries') as Promise<
        Array<{ seriesId: number; title: string; bytes: number }>
      >,
    cacheClearAll: () => ipcRenderer.invoke('cloud:cacheClearAll') as Promise<{ bytes: number }>,
    cacheClearSeries: (seriesId: number) =>
      ipcRenderer.invoke('cloud:cacheClearSeries', seriesId) as Promise<{ bytes: number }>,
    prefetch: (seriesId: number) =>
      ipcRenderer.invoke('cloud:prefetch', seriesId) as Promise<{ seriesId: number; done: number; total: number }>,
    prefetchCancel: (seriesId: number) =>
      ipcRenderer.invoke('cloud:prefetchCancel', seriesId) as Promise<boolean>,
    prefetchRunning: () =>
      ipcRenderer.invoke('cloud:prefetchRunning') as Promise<number[]>,
    browse: (folderId?: string, familyId?: string) =>
      ipcRenderer.invoke('cloud:browse', { folderId, familyId }),
    addLibrary: (folderId: string, familyId: string | undefined, name: string) =>
      ipcRenderer.invoke('cloud:addLibrary', { folderId, familyId, name })
  },
  cloud115: {
    status: () => ipcRenderer.invoke('cloud115:status'),
    qr: {
      /** 发起扫码登录：返回官方渲染的二维码图片（dataURL） */
      start: (): Promise<{ dataUrl: string }> =>
        ipcRenderer.invoke('cloud115:qrStart') as Promise<{ dataUrl: string }>,
      /** 轮询扫码状态：waiting 未扫码 / scanned 已扫码待确认 / done 成功 / expired 过期 */
      poll: (): Promise<{ state: 'waiting' | 'scanned' | 'done' | 'expired'; username?: string }> =>
        ipcRenderer.invoke('cloud115:qrPoll') as Promise<{
          state: 'waiting' | 'scanned' | 'done' | 'expired'
          username?: string
        }>
    },
    logout: () => ipcRenderer.invoke('cloud115:logout'),
    capacity: () => ipcRenderer.invoke('cloud115:capacity'),
    browse: (folderId?: string) =>
      ipcRenderer.invoke('cloud115:browse', { folderId }) as Promise<CloudBrowseResult>,
    addLibrary: (folderId: string, name: string) =>
      ipcRenderer.invoke('cloud115:addLibrary', { folderId, name })
  }
}

export type YibenApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('yiben', api)
  } catch (error) {
    console.error(error)
  }
} else {
  Object.assign(globalThis, { electron: electronAPI, yiben: api })
}
