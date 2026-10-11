import { openDb, getSeries, chaptersBySeries, getChapterPageFile, type SeriesRow } from './db'
import { createBackup } from './backup'
import { runExclusiveScan } from './rescan'
import { getSetting, setSetting } from './settings'
import type { ReaderPrefs } from '../shared/types'

export function mergeSources(target: number): SeriesRow[] {
  return openDb()
    .prepare(
      'SELECT s.* FROM series s JOIN series_merges m ON m.source_id = s.id WHERE m.target_id = ? ORDER BY s.title'
    )
    .all(target) as SeriesRow[]
}

/** 逻辑合并不移动原文件；章节、进度和书签继续使用原 id，扫描保持原归属。 */
export function mergeSeriesData(sourceId: number, targetId: number): void {
  const db = openDb()
  db.transaction(() => {
    const source = getSeries(sourceId),
      target = getSeries(targetId)
    if (!source || !target || sourceId === targetId) throw new Error('请选择两个不同的有效系列')
    if (source.library_id !== target.library_id) throw new Error('只能合并同一书库中的系列')
    if (db.prepare('SELECT 1 FROM series_merges WHERE source_id IN (?, ?)').get(sourceId, targetId))
      throw new Error('该系列已是合并来源，请先解除合并')
    db.prepare('UPDATE series_merges SET target_id = ? WHERE target_id = ?').run(targetId, sourceId)
    db.prepare('INSERT INTO series_merges (source_id, target_id) VALUES (?, ?)').run(
      sourceId,
      targetId
    )
    db.prepare(
      'INSERT OR IGNORE INTO series_shelves (series_id, shelf_id, added_at) SELECT ?, shelf_id, added_at FROM series_shelves WHERE series_id = ?'
    ).run(targetId, sourceId)
    db.prepare(
      'INSERT OR IGNORE INTO series_tags (series_id, tag_id) SELECT ?, tag_id FROM series_tags WHERE series_id = ?'
    ).run(targetId, sourceId)
    const prefs = getSetting<Record<string, ReaderPrefs>>('readerPrefs', {})
    if (!prefs[targetId] && prefs[sourceId]) {
      prefs[targetId] = prefs[sourceId]
      setSetting('readerPrefs', prefs)
    }
    const sources = new Set(mergeSources(targetId).map((row) => row.id))
    const pinned = getSetting<number[]>('offlinePinnedSeries', [])
    if (pinned.includes(targetId) || pinned.some((id) => sources.has(id))) {
      const ids = [...new Set([...pinned.filter((id) => !sources.has(id)), targetId])]
      const required = ids.flatMap(chaptersBySeries).reduce((sum, chapter) => {
        if (chapter.kind !== 'cfolder') return sum + chapter.size
        for (let index = 0; index < chapter.page_count; index++)
          sum += getChapterPageFile(chapter.id, index)?.size ?? 0
        return sum
      }, 0)
      if (required > getSetting<number>('cloudCacheCapMb', 20 * 1024) * 1024 * 1024)
        throw new Error('合并后的离线保护内容超过缓存容量，请先提高容量或解除保护')
      setSetting('offlinePinnedSeries', ids)
    }
    // 旧阅读日志也映射到主系列；拆分时按章节的真实归属恢复。
    db.prepare(
      'UPDATE reading_log SET series_id = ? WHERE chapter_id IN (SELECT id FROM effective_chapters WHERE series_id = ?)'
    ).run(targetId, targetId)
  })()
}

export function unmergeSeriesData(sourceId: number): void {
  const db = openDb()
  db.transaction(() => {
    const merge = db
      .prepare('SELECT target_id FROM series_merges WHERE source_id = ?')
      .get(sourceId) as { target_id: number } | undefined
    const pinned = getSetting<number[]>('offlinePinnedSeries', [])
    if (merge && pinned.includes(merge.target_id))
      setSetting('offlinePinnedSeries', [...new Set([...pinned, sourceId])])
    db.prepare('DELETE FROM series_merges WHERE source_id = ?').run(sourceId)
    db.prepare(
      'UPDATE reading_log SET series_id = ? WHERE chapter_id IN (SELECT id FROM chapters WHERE series_id = ?)'
    ).run(sourceId, sourceId)
  })()
}

export function mergeSeries(sourceId: number, targetId: number): Promise<{ chapters: number }> {
  return runExclusiveScan(async () => {
    await createBackup()
    mergeSeriesData(sourceId, targetId)
    return { chapters: chaptersBySeries(targetId).length }
  })
}
export function unmergeSeries(sourceId: number): Promise<void> {
  return runExclusiveScan(async () => {
    await createBackup()
    unmergeSeriesData(sourceId)
  })
}
