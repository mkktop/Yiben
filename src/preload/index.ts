import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
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
      filter?: 'all' | 'unread' | 'reading' | 'recent'
      limit?: number
      offset?: number
    }) => ipcRenderer.invoke('series:list', opts ?? {}),
    get: (id: number) => ipcRenderer.invoke('series:get', id),
    remove: (id: number) => ipcRenderer.invoke('series:remove', id)
  },
  home: {
    continue: () => ipcRenderer.invoke('home:continue'),
    recent: () => ipcRenderer.invoke('home:recent')
  },
  reader: {
    chapter: (chapterId: number) => ipcRenderer.invoke('reader:chapter', chapterId),
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
    }) => ipcRenderer.invoke('reader:prefs:set', { seriesId, prefs })
  },
  progress: {
    save: (chapterId: number, page: number, completed?: boolean) =>
      ipcRenderer.invoke('progress:save', { chapterId, page, completed })
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
    }
  },
  cloud: {
    status: () => ipcRenderer.invoke('cloud:status'),
    login: (username: string, password: string) =>
      ipcRenderer.invoke('cloud:login', { username, password }),
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
    browse: (folderId?: string, familyId?: string) =>
      ipcRenderer.invoke('cloud:browse', { folderId, familyId }),
    addLibrary: (folderId: string, familyId: string | undefined, name: string) =>
      ipcRenderer.invoke('cloud:addLibrary', { folderId, familyId, name })
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
