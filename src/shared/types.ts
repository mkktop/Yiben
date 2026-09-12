/** 渲染进程与主进程共享的 API 数据类型 */

export interface Library {
  id: number
  name: string
  path: string
  kind: 'local' | 'cloud189' | string
  created_at: number
  cloud_folder_id?: string | null
  family_id?: string | null
}

export interface CloudEntryLite {
  id: string
  name: string
  size?: number
}

export interface CloudBrowseResult {
  folders: CloudEntryLite[]
  files: CloudEntryLite[]
}

export interface CloudStatus {
  loggedIn: boolean
  username: string
}

export interface Series {
  id: number
  library_id: number
  title: string
  author: string | null
  cover_path: string | null
  description: string | null
  status: string | null
  /** JSON 数组字符串 */
  tags: string | null
  folder_path: string
  is_single_file: number
  added_at: number
  /** 发表年份（ComicInfo Year） */
  year?: number | null
  /** 语言代码（ComicInfo LanguageISO） */
  language?: string | null
}

export interface Chapter {
  id: number
  series_id: number
  title: string
  volume: string | null
  number: number | null
  sort_index: number
  path: string
  kind: string
  page_count: number
  size: number
  mtime: number
  /** 扫描列页失败的原因；成功为 null */
  scan_error?: string | null
}

export interface ChapterWithProgress extends Chapter {
  read_page: number | null
  completed: number | null
}

export interface SeriesDetail {
  series: Series
  chapters: ChapterWithProgress[]
  /** 所属书库类型（云端系列展示「离线缓存」等专属操作） */
  libraryKind: string
}

export interface ContinueItem {
  chapter_id: number
  chapter_title: string
  read_page: number
  completed: number
  updated_at: number
  series_id: number
  series_title: string
  cover_path: string | null
  page_count: number
}

export interface ReaderChapterInfo {
  chapter: Chapter & { series_title: string }
  progress: { chapter_id: number; page: number; completed: number; updated_at: number } | null
}

export interface ScanProgress {
  libraryId: number
  phase: 'listing' | 'reading' | 'done'
  current?: number
  total?: number
  title?: string
}

export type SeriesFilter = 'all' | 'unread' | 'reading' | 'read' | 'recent'

/** 虚拟书架（用户自建的分组，独立于物理书库） */
export interface ShelfInfo {
  id: number
  name: string
  sort: number
}

/** 自定义标签（关联表存储，独立于 ComicInfo 导入的 series.tags 列） */
export interface TagInfo {
  id: number
  name: string
}

// ---------- 库体检（只读诊断） ----------

export interface DiagnoseBrokenChapter {
  id: number
  title: string
  seriesId: number
  seriesTitle: string
  /** 扫描列页失败的原因（chapters.scan_error） */
  reason: string
}

export interface DiagnoseEmptyChapter {
  id: number
  title: string
  seriesTitle: string
}

export interface DiagnoseDuplicateItem {
  id: number
  title: string
  folderPath: string
}

/** 库体检报告：只读诊断结果，不做任何自动修复 */
export interface DiagnoseReport {
  brokenChapters: DiagnoseBrokenChapter[]
  emptyChapters: DiagnoseEmptyChapter[]
  /** 归一化标题相同的系列分组（组内 >1 个才算重复） */
  duplicateSeries: DiagnoseDuplicateItem[][]
  /** 没有对应章节行的页缩略图目录总字节数（只统计，不删除） */
  orphanThumbBytes: number
}

/** 跨话书签（阅读器书签面板用） */
export interface BookmarkInfo {
  chapter_id: number
  chapter_title: string
  page: number
  created_at: number
}

/** 整系列离线预取进度（主进程推送） */
export interface PrefetchProgress {
  seriesId: number
  done: number
  total: number
  chapterTitle: string
}

export interface PrefetchDone {
  seriesId: number
  cancelled: boolean
  error?: string
  /** 重试后仍失败的章节标题（其余章节照常完成） */
  failed?: string[]
}

/** 云端风控/会话异常通知（主进程推送） */
export interface CloudNotice {
  kind: 'session' | 'ratelimit'
  message: string
}

/** 阅读偏好（按系列记忆，存主进程 electron-store） */
export interface ReaderPrefs {
  /** single | double | webtoon */
  mode?: 'single' | 'double' | 'webtoon'
  /** width | height | original */
  fit?: 'width' | 'height' | 'original'
  /** 日漫从右往左 */
  rtl?: boolean
  /** 0/90/180/270 */
  rotate?: number
  /** 双页配对偏移（C 键切换）：0 = (1,2)(3,4)…；1 = 第 1 页单独、(2,3)(4,5)… */
  spreadOffset?: 0 | 1
}

export function coverUrl(seriesId: number): string {
  return `yiben://thumb/${seriesId}`
}

export function pageUrl(chapterId: number, index: number): string {
  return `yiben://page/${chapterId}/${index}`
}

/** 缩略图条用的小图（主进程 sharp 缩小并落盘缓存） */
export function pageThumbUrl(chapterId: number, index: number): string {
  return `yiben://page-thumb/${chapterId}/${index}`
}

export function parseTags(tags: string | null): string[] {
  if (!tags) return []
  try {
    const arr = JSON.parse(tags)
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}
