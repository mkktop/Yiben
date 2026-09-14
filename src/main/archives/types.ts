/**
 * 单条目解压上限（本地与云端归档共用防线）：网上下载的漫画压缩包是不可信输入，
 * 高压缩比 zip/rar bomb 可把主进程 OOM。驱动按声明尺寸拦截 + 协议层按实际产出兜底。
 */
export const MAX_ARCHIVE_ENTRY_BYTES = 200 * 1024 * 1024

export interface PageEntry {
  name: string
  size: number
}

export interface ArchiveDriver {
  /** 图片页列表（自然排序） */
  listPages(): Promise<PageEntry[]>
  /** 读取第 index 页（0 起） */
  readPage(index: number): Promise<Buffer>
  /** 读包内单个文件（如 ComicInfo.xml）；不存在或失败返回 null */
  readEntry?(name: string): Promise<Buffer | null>
  close(): Promise<void>
}

export type DriverKind = 'folder' | 'zip' | 'epub' | 'rar' | '7z' | 'tar' | 'pdf'

export class UnsupportedFormatError extends Error {
  constructor(kind: string) {
    super(`暂不支持的格式：${kind}`)
    this.name = 'UnsupportedFormatError'
  }
}
