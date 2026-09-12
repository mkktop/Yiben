import { app } from 'electron'
import { readdir, stat } from 'fs/promises'
import { join } from 'path'
import { openDb } from './db'
import { longPath } from './util/paths'
import type { DiagnoseDuplicateItem, DiagnoseReport } from '../shared/types'

export type { DiagnoseReport } from '../shared/types'

/**
 * 标题归一化（重复系列分组的键）：
 * 全角转半角 → 转小写 → 剥掉末尾卷次后缀（第N卷 / Vol.N / v3 / (N) 等）→ 去空白与标点。
 * 返回空串（标题只剩卷号）时调用方应跳过分组，避免把不同作品误判成重复。
 */
export function normalizeTitle(title: string): string {
  let unfolded = ''
  for (const ch of title) {
    const code = ch.codePointAt(0) ?? 0
    // 全角 ASCII 与全角标点（FF01–FF5E）、全角空格（3000）折成半角
    if (code >= 0xff01 && code <= 0xff5e) unfolded += String.fromCharCode(code - 0xfee0)
    else if (code === 0x3000) unfolded += ' '
    else unfolded += ch
  }
  let s = unfolded.toLowerCase()
  // 末尾卷次后缀：第N卷/话/冊/巻、Vol.N / volume N、V3、(N)、[N]
  s = s.replace(
    /(?:[\s._-]*)(?:第\s*\d+(?:\.\d+)?\s*[卷話话冊册巻]|vol(?:ume)?\.?\s*\d+(?:\.\d+)?|v\d+(?:\.\d+)?|\[\d+\]|\(\d+\))\s*$/i,
    ''
  )
  // 空白与标点/符号不参与比较（保留字母、数字与中日韩文字）
  return s.replace(/[\s\p{P}\p{S}]+/gu, '')
}

/** 按归一化标题分组，只返回组内数量 > 1 的组（真正重复的） */
export function groupDuplicateSeries(
  rows: Array<{ id: number; title: string; folder_path: string }>
): Array<Array<DiagnoseDuplicateItem>> {
  const groups = new Map<string, Array<DiagnoseDuplicateItem>>()
  for (const row of rows) {
    const key = normalizeTitle(row.title)
    if (!key) continue
    const item: DiagnoseDuplicateItem = { id: row.id, title: row.title, folderPath: row.folder_path }
    const list = groups.get(key)
    if (list) list.push(item)
    else groups.set(key, [item])
  }
  return [...groups.values()].filter((g) => g.length > 1)
}

/** 递归统计目录字节数 */
async function dirSize(dir: string): Promise<number> {
  let entries
  try {
    entries = await readdir(longPath(dir), { withFileTypes: true })
  } catch {
    return 0
  }
  let total = 0
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) total += await dirSize(full)
    else {
      try {
        total += (await stat(longPath(full))).size
      } catch {
        /* 刚被淘汰的文件，忽略 */
      }
    }
  }
  return total
}

/**
 * 统计孤儿页缩略图的总体积：thumbs/pages 下每个目录以章节 id 命名，
 * 目录在 chapters 表里找不到对应 id 即为孤儿（只统计，不删除——删除交给用户决定）。
 */
async function countOrphanThumbBytes(): Promise<number> {
  const root = join(app.getPath('userData'), 'thumbs', 'pages')
  const ids = new Set(
    (openDb().prepare('SELECT id FROM chapters').all() as Array<{ id: number }>).map((r) => r.id)
  )
  let dirs
  try {
    dirs = await readdir(longPath(root), { withFileTypes: true })
  } catch {
    return 0 // 目录不存在 = 没有页缩略图
  }
  let total = 0
  for (const entry of dirs) {
    if (!entry.isDirectory()) continue
    if (ids.has(Number(entry.name))) continue
    total += await dirSize(join(root, entry.name))
  }
  return total
}

/**
 * 库体检（只读诊断）：损坏章节 / 空章节 / 重复系列 / 孤儿页缩略图体积。
 * 损坏与空章节以扫描落库的 scan_error / page_count 为准——每次重扫都会刷新它们
 * （成功置 NULL），所以这里不再重新打开压缩包校验；修复交给用户按钮（重扫/移出书架）。
 * 整个过程在扫描互斥锁内执行，进度复用 scan:progress 广播，终态必须发 phase:'done'
 * 让右下角扫描浮标收尾。
 */
export async function runDiagnose(libraryId?: number): Promise<DiagnoseReport> {
  // 懒加载：单测只测归一化纯函数时，不必把 sharp/压缩包驱动整条链路拖进来
  const { runExclusiveScan } = await import('./rescan')
  const { broadcast } = await import('./events')
  return runExclusiveScan(async () => {
    broadcast('scan:progress', { phase: 'reading', title: '库体检' })
    try {
      const db = openDb()
      const libCond = libraryId ? 'AND s.library_id = ?' : ''
      const libParams = libraryId ? [libraryId] : []

      // PDF 的 scan_error（"暂不支持的格式"）是能力边界而非损坏：页数由渲染进程回填，
      // 所以与空章节一样把 pdf 排除，避免体检误报能正常打开的 PDF
      const brokenChapters = db
        .prepare(
          `SELECT c.id, c.title, s.id AS seriesId, s.title AS seriesTitle, c.scan_error AS reason
           FROM chapters c JOIN series s ON s.id = c.series_id
           WHERE c.scan_error IS NOT NULL AND c.kind != 'pdf' ${libCond}
           ORDER BY s.title, c.sort_index`
        )
        .all(...libParams) as DiagnoseReport['brokenChapters']

      // 页数为 0 的非 PDF 章节：PDF 页数由渲染进程回填，0 是正常态，不算空章节
      const emptyChapters = db
        .prepare(
          `SELECT c.id, c.title, s.title AS seriesTitle
           FROM chapters c JOIN series s ON s.id = c.series_id
           WHERE c.page_count = 0 AND c.kind != 'pdf' ${libCond}
           ORDER BY s.title, c.sort_index`
        )
        .all(...libParams) as DiagnoseReport['emptyChapters']

      const seriesRows = (
        libraryId
          ? db.prepare('SELECT id, title, folder_path FROM series WHERE library_id = ?').all(libraryId)
          : db.prepare('SELECT id, title, folder_path FROM series').all()
      ) as Array<{ id: number; title: string; folder_path: string }>
      const duplicateSeries = groupDuplicateSeries(seriesRows)

      const orphanThumbBytes = await countOrphanThumbBytes()

      return { brokenChapters, emptyChapters, duplicateSeries, orphanThumbBytes }
    } finally {
      broadcast('scan:progress', { phase: 'done' })
    }
  })
}
