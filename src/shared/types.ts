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
}

export interface ChapterWithProgress extends Chapter {
  read_page: number | null
  completed: number | null
}

export interface SeriesDetail {
  series: Series
  chapters: ChapterWithProgress[]
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

export type SeriesFilter = 'all' | 'unread' | 'reading' | 'recent'

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
