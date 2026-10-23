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

export interface DatabaseBackup {
  id: string
  createdAt: number
  bytes: number
  safety: boolean
}
export interface WebDavConfig {
  name: string
  url: string
  username: string
  password: string
  /** 挂载的子目录（browse 阶段选择的 base64url 路径 id）；缺省挂 url 本身 */
  rootId?: string
}
export interface MetadataCandidate {
  id: string
  title: string
  author: string
  description: string
  status: string
  tags: string[]
  url: string
}

export interface CloudEntryLite {
  id: string
  name: string
  size?: number
  /** 该目录已是挂载书库（browse 出口由主进程对照 libraries 计算好） */
  mounted?: boolean
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
  /** 系列级进度聚合（series:list 返回，非表列）：已读完章节数 / 章节总数 */
  read_chapters?: number
  total_chapters?: number
  /** 已开始话数，以及已完成话数加上未完话的页进度（未知页数不估算）。 */
  started_chapters?: number
  chapter_progress?: number
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
  read_updated_at: number | null
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
  /** 续读目标可能是尚未打开的下一话。 */
  started: boolean
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

export type SeriesFilter = 'all' | 'unread' | 'reading' | 'completed' | 'read' | 'recent'

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
  offline?: OfflineStatus
}

export interface OfflineStatus {
  seriesId: number
  total: number
  complete: number
  bytes: number
  requiredBytes: number
  pinned: boolean
  missing: string[]
  capacityExceeded: boolean
}

/** 云端风控/会话异常通知（主进程推送） */
export interface CloudNotice {
  kind: 'session' | 'ratelimit'
  message: string
  /** 哪家网盘发出的通知，重连成功后按它精确清除对应提示 */
  provider?: 'cloud189' | '115'
}

/** 显式登录/登出导致的会话状态变化（启动时的静默恢复不推送） */
export interface CloudSessionEvent {
  provider: 'cloud189' | '115'
  loggedIn: boolean
}

/** 阅读偏好（按系列记忆，存主进程 electron-store） */
export interface ReaderPrefs {
  enhance?: boolean
  sharpness?: number
  autoTrim?: boolean
  contrast?: number
  brightness?: number
  warmth?: number
  eyeSchedule?: boolean
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
  /** 阅读器缩放（0.5–4，1 = 100%）；翻页/切话保持，换适配方式或阅读模式时复位 */
  zoom?: number
}

export function coverUrl(seriesId: number): string {
  return `yudu://thumb/${seriesId}`
}

export function pageUrl(chapterId: number, index: number, prefs?: ReaderPrefs): string {
  const base = `yudu://page/${chapterId}/${index}`
  return prefs?.enhance
    ? `${base}?enhance=1&sharpness=${prefs.sharpness ?? 1}&trim=${prefs.autoTrim ? 1 : 0}&contrast=${prefs.contrast ?? 1}`
    : base
}

/** 缩略图条用的小图（主进程 sharp 缩小并落盘缓存） */
export function pageThumbUrl(chapterId: number, index: number): string {
  return `yudu://page-thumb/${chapterId}/${index}`
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
