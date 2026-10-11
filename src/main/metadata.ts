import { createHash } from 'crypto'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { path7za } from '7zip-bin'
import {
  getLibrary,
  getSeries,
  chaptersBySeries,
  updateSeriesMeta,
  rebuildFts,
  openDb,
  type SeriesRow
} from './db'
import { withDriver } from './archives'
import { limitedText } from './webdav/client'
import { XMLBuilder } from 'fast-xml-parser'
import { parseTags, type MetadataCandidate } from '../shared/types'
import { createBackup } from './backup'
import { runExclusiveScan } from './rescan'
import { setSetting } from './settings'
import { normalizeTitle } from './diagnose'

const STATUS: Record<string, string> = {
  FINISHED: '已完结',
  RELEASING: '连载中',
  NOT_YET_RELEASED: '未发行',
  CANCELLED: '已取消',
  HIATUS: '休刊中'
}
const candidates = new Map<string, MetadataCandidate>()
export async function searchMetadata(search: string): Promise<MetadataCandidate[]> {
  if (!search.trim() || search.length > 200) throw new Error('请输入 1–200 字的漫画标题')
  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query ($search: String!) { Page(page: 1, perPage: 8) { media(search: $search, type: MANGA) { id title { native romaji english } description(asHtml: false) status genres siteUrl staff(perPage: 6) { edges { role node { name { native full } } } } } } }`,
      variables: { search }
    })
  })
  if (response.status === 429) throw new Error('元数据服务请求过于频繁，请稍后重试')
  if (!response.ok) throw new Error(`元数据查询失败：HTTP ${response.status}`)
  const data = JSON.parse(await limitedText(response, 1024 * 1024))
  if (data.errors?.length) throw new Error('元数据服务返回错误，请稍后重试')
  const list: MetadataCandidate[] = (data.data?.Page?.media ?? []).map(
    (item: {
      id: number
      title: { native?: string; romaji?: string; english?: string }
      description?: string
      status?: string
      genres?: string[]
      siteUrl?: string
      staff?: { edges: Array<{ role: string; node: { name: { native?: string; full?: string } } }> }
    }) => ({
      id: `anilist:${item.id}`,
      title: item.title.native || item.title.romaji || item.title.english || search,
      author: (item.staff?.edges ?? [])
        .filter((edge) => /story|art|original/i.test(edge.role))
        .map((edge) => edge.node.name.native || edge.node.name.full)
        .filter(Boolean)
        .join(' / '),
      description: (item.description ?? '').replace(/<[^>]*>/g, '').slice(0, 20000),
      status: STATUS[item.status ?? ''] ?? '',
      tags: item.genres ?? [],
      url: item.siteUrl ?? ''
    })
  )
  for (const item of list) candidates.set(item.id, item)
  while (candidates.size > 128) candidates.delete(candidates.keys().next().value!)
  return list.sort(
    (a, b) =>
      Number(normalizeTitle(b.title) === normalizeTitle(search)) -
      Number(normalizeTitle(a.title) === normalizeTitle(search))
  )
}
export function applyMetadata(seriesId: number, candidateId: string): void {
  const item = candidates.get(candidateId)
  if (!item || !getSeries(seriesId)) throw new Error('候选结果已失效，请重新搜索')
  updateSeriesMeta(seriesId, {
    title: item.title,
    author: item.author || null,
    description: item.description || null,
    status: item.status || null,
    tags: item.tags.length ? JSON.stringify(item.tags) : null
  })
  rebuildFts()
}

export function buildComicInfo(series: NonNullable<ReturnType<typeof getSeries>>): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    new XMLBuilder({ format: true }).build({
      ComicInfo: {
        Series: series.title,
        Title: series.title,
        Writer: series.author ?? '',
        Summary: series.description ?? '',
        Status: series.status ?? '',
        Genre: parseTags(series.tags).join(', '),
        Year: series.year ?? '',
        LanguageISO: series.language ?? ''
      }
    })
  )
}
async function pageHashes(file: string): Promise<string[]> {
  return withDriver(file, false, async (driver) => {
    const pages = await driver.listPages()
    const hashes: string[] = []
    for (let index = 0; index < pages.length; index++)
      hashes.push(
        `${pages[index].name}:${createHash('sha256')
          .update(await driver.readPage(index))
          .digest('hex')}`
      )
    return hashes
  })
}

/** 目录写 ComicInfo；ZIP 在副本中更新并逐页校验，原图字节保持不变。 */
export function writeComicInfo(seriesId: number): Promise<string[]> {
  return runExclusiveScan(async () => {
    const series = getSeries(seriesId)
    if (!series || getLibrary(series.library_id)?.kind !== 'local')
      throw new Error('仅本地书库支持回写元数据')
    await createBackup()
    const xml = buildComicInfo(series)
    const targets: string[] = []
    const sources = openDb()
      .prepare(
        'SELECT s.* FROM series s JOIN series_merges m ON m.source_id = s.id WHERE m.target_id = ?'
      )
      .all(seriesId) as SeriesRow[]
    for (const entry of [series, ...sources].filter((row) => !row.is_single_file)) {
      const file = join(entry.folder_path, 'ComicInfo.xml')
      const old = await readFile(file).catch(() => null)
      if (old) await writeFile(`${file}.before-yudu-${Date.now()}`, old)
      await writeFile(`${file}.yudu-tmp`, xml)
      await rename(`${file}.yudu-tmp`, file)
      targets.push(file)
    }
    for (const chapter of chaptersBySeries(seriesId)) {
      if (chapter.kind !== 'zip') {
        if (getSeries(chapter.origin_series_id ?? chapter.series_id)?.is_single_file) {
          const sidecar = `${chapter.path}.ComicInfo.xml`
          const old = await readFile(sidecar).catch(() => null)
          if (old) await writeFile(`${sidecar}.before-yudu-${Date.now()}`, old)
          await writeFile(`${sidecar}.yudu-tmp`, xml)
          await rename(`${sidecar}.yudu-tmp`, sidecar)
          targets.push(sidecar)
        }
        continue
      }
      const before = await stat(chapter.path)
      const hashes = await pageHashes(chapter.path)
      const workspace = join(dirname(chapter.path), `.yudu-metadata-${Date.now()}-${chapter.id}`)
      await mkdir(workspace)
      const staged = join(workspace, 'chapter.zip')
      try {
        await copyFile(chapter.path, staged)
        await writeFile(join(workspace, 'ComicInfo.xml'), xml)
        await promisify(execFile)(path7za, ['u', '-tzip', staged, 'ComicInfo.xml', '-y'], {
          cwd: workspace,
          windowsHide: true
        })
        if (JSON.stringify(await pageHashes(staged)) !== JSON.stringify(hashes))
          throw new Error('回写校验失败：漫画页面发生变化')
        const current = await stat(chapter.path)
        if (current.mtimeMs !== before.mtimeMs || current.size !== before.size)
          throw new Error('漫画文件在回写期间已被修改，请重试')
        await copyFile(chapter.path, `${chapter.path}.before-yudu-${Date.now()}`)
        await rename(staged, chapter.path)
        targets.push(chapter.path)
      } finally {
        await rm(workspace, { recursive: true, force: true })
      }
    }
    setSetting('lastMetadataWrite', { seriesId, files: targets })
    return targets
  })
}
