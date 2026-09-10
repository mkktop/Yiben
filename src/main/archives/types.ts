export interface PageEntry {
  name: string
  size: number
}

export interface ArchiveDriver {
  /** 图片页列表（自然排序） */
  listPages(): Promise<PageEntry[]>
  /** 读取第 index 页（0 起） */
  readPage(index: number): Promise<Buffer>
  close(): Promise<void>
}

export type DriverKind = 'folder' | 'zip' | 'rar' | '7z' | 'tar' | 'pdf'

export class UnsupportedFormatError extends Error {
  constructor(kind: string) {
    super(`暂不支持的格式：${kind}`)
    this.name = 'UnsupportedFormatError'
  }
}
