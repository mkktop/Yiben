import { join } from 'path'
import {
  deleteChaptersNotIn,
  getChapterMetaIfUnchanged,
  getLibrary,
  rebuildFts,
  replaceChapterPages,
  retireSeriesNotIn,
  seriesPathExists,
  upsertChapter,
  upsertSeries
} from '../db'
import { archiveKindOf, isImageFile, stripArchiveExt } from '../util/paths'
import { parseChapterName } from '../scanner/parse'
import { removeSeriesArtifacts } from '../thumbnail'
import { removePageThumbs } from '../pageThumb'
import type { CloudEntry } from '../cloud115/parsing'

export interface CloudScanProgress {
  libraryId: number
  current: number
  total: number
  title: string
  phase: 'reading' | 'done'
}

interface ChapterInput {
  cloudId: string
  name: string
  size: number
  isDir: boolean
  /** 云端条目的最后修改时间，用于增量跳过逐章列举 */
  mtime?: number
}

/**
 * 云盘扫描的 provider 描述符：不同网盘只提供目录列举、缓存根目录与 URI scheme，
 * 目录布局识别与入库逻辑完全共用（天翼云盘与 115 的目录语义一致）。
 */
export interface CloudScanDeps {
  libraryId: number
  cloudFolderId: string
  /** 家庭云等第二编号空间（仅天翼）：参与缓存文件名，避免不同空间的同 id 串缓存 */
  familyId?: string
  listAll(folderId: string): Promise<CloudEntry[]>
  cacheDir(): string
  /** folder_path 的 scheme 前缀，如 cloud189 / cloud115 */
  scheme: string
}

/** 卷文件夹：直接包含图片或漫画压缩包 */
function isVolumeChildren(children: CloudEntry[]): boolean {
  return children.some((e) => !e.isDir && (isImageFile(e.name) || Boolean(archiveKindOf(e.name))))
}

/**
 * 限并发列举：wrapper 目录判定原来用 Promise.all 全量并发，
 * 大库一次就能同时压出几十个列表请求（风控敏感的 burst 形态）
 */
async function listAllLimited(
  ids: string[],
  list: (id: string) => Promise<CloudEntry[]>,
  limit = 2
): Promise<CloudEntry[][]> {
  const out: CloudEntry[][] = new Array(ids.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, ids.length) }, async () => {
    while (next < ids.length) {
      const i = next++
      out[i] = await list(ids[i])
    }
  })
  const results = await Promise.allSettled(workers)
  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  )
  if (failed) throw failed.reason
  return out
}

/**
 * 扫描云盘目录。自动识别两种布局：
 *  - 单系列：用户直接添加某部漫画的文件夹（根下全是卷文件夹/同名嵌套文件夹/分卷压缩包）→ 整个库根作为一个系列
 *  - 多系列：根下每个文件夹是一部作品（内部再分章节），根下压缩包各自成单文件系列
 * 纯视频等无漫画内容的目录会被跳过；已删除的云端文件会同步清出书架。
 */
export async function scanCloudLibrary(
  deps: CloudScanDeps,
  onProgress?: (p: CloudScanProgress) => void
): Promise<{ series: number; chapters: number; missing?: number }> {
  const { libraryId, cloudFolderId, familyId, listAll, cacheDir, scheme } = deps
  // 根目录递归遍历（分页拉取 + 逐个下钻分类 + 限流闸串行）是整条扫描里最慢的
  // 一段，先发一条让浮标立刻出现，否则大库开头十几分钟没有任何反馈
  onProgress?.({ libraryId, current: 0, total: 0, title: '正在读取云端目录', phase: 'reading' })
  const cache = new Map<string, CloudEntry[]>()
  const list = async (id: string): Promise<CloudEntry[]> => {
    let v = cache.get(id)
    if (!v) {
      v = await listAll(id)
      cache.set(id, v)
    }
    return v
  }

  const root = await list(cloudFolderId)
  const rootDirs = root.filter((e) => e.isDir)
  const rootArchives = root.filter((e) => !e.isDir && archiveKindOf(e.name))

  /** 条目是否为库内已验证（页数>0）且 mtime 未变的章节目录；增量判定复用 */
  const isVerifiedChapterDir = (e: CloudEntry): boolean => {
    if (!e.mtime) return false
    const reuse = getChapterMetaIfUnchanged(join(cacheDir(), `f-${e.id}`), 0, e.mtime)
    return reuse !== null && reuse > 0
  }

  // 根下文件夹分类：volume=卷文件夹 wrapper=同名嵌套等包装层 series=独立作品
  const dirKind = new Map<string, 'volume' | 'wrapper' | 'series'>()
  for (const [i, d] of rootDirs.entries()) {
    onProgress?.({
      libraryId,
      current: i,
      total: rootDirs.length,
      title: `分析目录：${d.name}`,
      phase: 'reading'
    })
    const children = await list(d.id)
    if (isVolumeChildren(children)) {
      dirKind.set(d.id, 'volume')
    } else {
      const subDirs = children.filter((e) => e.isDir)
      const allDirs = subDirs.length > 0 && subDirs.length === children.length
      let isWrapper = false
      if (allDirs) {
        // 增量：根系列已入库且每个子目录都是已验证的章节目录（mtime 未变）→
        // 子目录仍是图片目录，上轮 wrapper 分类不变，跳过逐个下钻列举。
        // 多系列布局（子目录各自成系列）在库里没有 f-{子目录id} 章节，不会误命中
        if (seriesPathExists(`${scheme}://${cloudFolderId}`) && subDirs.every(isVerifiedChapterDir)) {
          isWrapper = true
        } else {
          isWrapper = (await listAllLimited(subDirs.map((s) => s.id), list)).every((c) =>
            isVolumeChildren(c)
          )
        }
      }
      dirKind.set(d.id, isWrapper ? 'wrapper' : 'series')
    }
  }

  const singleSeries = rootDirs.length > 0 && rootDirs.every((d) => dirKind.get(d.id) !== 'series')

  const keepSeries: string[] = []
  let chapterTotal = 0

  /** 写入一个系列；空系列（无有效章节）返回 false 不入库。
   *  onChapter：逐章校验（目录章节要列举一次数页数）开始时回调，
   *  供调用方把进度标题细化到「系列名（第 i/n 章）」，多卷系列不再长时间停在整系列一格 */
  const writeSeries = async (
    input: {
      title: string
      folderPath: string
      isSingleFile: boolean
      chapters: ChapterInput[]
    },
    onChapter?: (chapterIndex: number, chapterTotal: number) => void
  ): Promise<boolean> => {
    const chapters: Array<ChapterInput & { reuse?: number }> = []
    for (const [i, ch] of input.chapters.entries()) {
      onChapter?.(i, input.chapters.length)
      if (ch.isDir) {
        // 增量：父目录列表里的 mtime 与库内记录一致且页数已验证（>0）→
        // 跳过逐章列举（列表调用是云端扫描的主要成本）。mtime 缺省或对不上仍全量列举
        const reuse = ch.mtime
          ? getChapterMetaIfUnchanged(join(cacheDir(), `f-${ch.cloudId}`), 0, ch.mtime)
          : null
        if (reuse !== null && reuse > 0) {
          chapters.push({ ...ch, reuse })
          continue
        }
        const pages = (await list(ch.cloudId)).filter((e) => !e.isDir && isImageFile(e.name))
        if (pages.length > 0) chapters.push(ch)
      } else {
        chapters.push(ch)
      }
    }
    if (chapters.length === 0) return false

    chapters.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    const seriesId = upsertSeries({
      library_id: libraryId,
      title: input.title,
      author: null,
      description: null,
      status: null,
      tags: null,
      folder_path: input.folderPath,
      is_single_file: input.isSingleFile ? 1 : 0
    })
    keepSeries.push(input.folderPath)

    const keepPaths: string[] = []
    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i]
      const parsed = parseChapterName(stripArchiveExt(ch.name))

      if (ch.isDir) {
        // 云端散图章节：页清单直接入库，阅读时按页下载
        const path = join(cacheDir(), `f-${ch.cloudId}`)
        if (ch.reuse) {
          // 增量命中：页清单沿用库内记录（不调 replaceChapterPages），只回写 mtime
          upsertChapter({
            series_id: seriesId,
            title: parsed.title,
            volume: null,
            number: parsed.number ?? parsed.volume ?? null,
            sort_index: i,
            path,
            kind: 'cfolder',
            page_count: ch.reuse,
            size: 0,
            mtime: ch.mtime ?? 0
          })
          keepPaths.push(path)
          chapterTotal++
          continue
        }
        const pages = (await list(ch.cloudId)).filter((e) => !e.isDir && isImageFile(e.name))
        const chapterId = upsertChapter({
          series_id: seriesId,
          title: parsed.title,
          volume: null,
          number: parsed.number ?? parsed.volume ?? null,
          sort_index: i,
          path,
          kind: 'cfolder',
          page_count: pages.length,
          size: 0,
          mtime: ch.mtime ?? 0
        })
        replaceChapterPages(
          chapterId,
          pages.map((p) => ({ file_id: p.id, name: p.name, size: p.size }))
        )
        keepPaths.push(path)
      } else {
        // 云端压缩包/PDF：页数未知，打开时整包下载再统计。
        // 缓存文件名带 familyId 维度：个人云与家庭云的文件 id 是两套编号空间，
        // 不区分的话同 id 不同内容（且大小恰好相同）会互相命中错误缓存
        const ext = ch.name.slice(ch.name.lastIndexOf('.'))
        const path = join(cacheDir(), `a-${familyId ? `f${familyId}-` : ''}${ch.cloudId}${ext}`)
        upsertChapter({
          series_id: seriesId,
          title: parsed.title,
          volume: null,
          number: parsed.number ?? parsed.volume ?? null,
          sort_index: i,
          path,
          kind: archiveKindOf(ch.name) as string,
          page_count: 0,
          size: ch.size,
          mtime: 0,
          cloud_file_id: ch.cloudId
        })
        keepPaths.push(path)
      }
      chapterTotal++
    }
    // 被删章节的页缩略图目录在文件系统里，级联删除清不到，这里跟删
    if (keepPaths.length > 0) {
      const removed = deleteChaptersNotIn(seriesId, keepPaths)
      if (removed.length > 0) await removePageThumbs(removed)
    }
    return true
  }

  if (singleSeries) {
    onProgress?.({ libraryId, current: 0, total: 1, title: '云端目录', phase: 'reading' })
    const chapters: ChapterInput[] = rootArchives.map((f) => ({
      cloudId: f.id,
      name: f.name,
      size: f.size,
      isDir: false,
      mtime: f.mtime
    }))
    for (const d of rootDirs) {
      const kind = dirKind.get(d.id)
      if (kind === 'volume') {
        chapters.push({ cloudId: d.id, name: d.name, size: 0, isDir: true, mtime: d.mtime })
      } else if (kind === 'wrapper') {
        // 同名嵌套包装层：展开为其中各卷
        for (const sub of await list(d.id)) {
          if (sub.isDir)
            chapters.push({ cloudId: sub.id, name: sub.name, size: 0, isDir: true, mtime: sub.mtime })
          else if (archiveKindOf(sub.name))
            chapters.push({ cloudId: sub.id, name: sub.name, size: sub.size, isDir: false, mtime: sub.mtime })
        }
      }
    }
    const title = getLibrary(libraryId)?.name ?? '云端系列'
    await writeSeries(
      {
        title,
        folderPath: `${scheme}://${cloudFolderId}`,
        isSingleFile: false,
        chapters
      },
      // 单系列模式整个库根就是一部作品，章节序号直接当进度计数用
      chapters.length > 1
        ? (ci, ct) =>
            onProgress?.({
              libraryId,
              current: ci,
              total: ct,
              title: `${title}（${ci + 1}/${ct}）`,
              phase: 'reading'
            })
        : undefined
    )
  } else {
    const seriesDirs = rootDirs
    const inputs: Array<{ title: string; entry: CloudEntry; single: boolean }> = [
      ...seriesDirs.map((f) => ({ title: f.name, entry: f, single: false })),
      ...rootArchives.map((f) => ({ title: stripArchiveExt(f.name), entry: f, single: true }))
    ]

    for (const [seriesIndex, input] of inputs.entries()) {
      onProgress?.({
        libraryId,
        current: seriesIndex,
        total: inputs.length,
        title: input.title,
        phase: 'reading'
      })

      if (input.single) {
        await writeSeries({
          title: input.title,
          folderPath: `${scheme}://${input.entry.id}`,
          isSingleFile: true,
          chapters: [
            {
              cloudId: input.entry.id,
              name: input.entry.name,
              size: input.entry.size,
              isDir: false
            }
          ]
        })
      } else {
        const children = await list(input.entry.id)
        const dirs = children.filter((e) => e.isDir)
        const files = children.filter((e) => !e.isDir)
        const chapters: ChapterInput[] = [
          ...dirs.map((d) => ({ cloudId: d.id, name: d.name, size: 0, isDir: true, mtime: d.mtime })),
          ...files
            .filter((f) => archiveKindOf(f.name))
            .map((f) => ({ cloudId: f.id, name: f.name, size: f.size, isDir: false, mtime: f.mtime }))
        ]
        if (files.some((f) => isImageFile(f.name))) {
          chapters.push({
            cloudId: input.entry.id,
            name: input.title,
            size: 0,
            isDir: true,
            mtime: input.entry.mtime
          })
        }
        await writeSeries(
          {
            title: input.title,
            folderPath: `${scheme}://${input.entry.id}`,
            isSingleFile: false,
            chapters
          },
          // 进度条仍按系列推进（current/total 口径不变），标题细化到章，
          // 避免同一条目内两套计数互相打架
          chapters.length > 1
            ? (ci, ct) =>
                onProgress?.({
                  libraryId,
                  current: seriesIndex,
                  total: inputs.length,
                  title: `${input.title}（${ci + 1}/${ct}）`,
                  phase: 'reading'
                })
            : undefined
        )
      }
    }
  }

  // 一个系列都没识别出来时不动已有数据：空结果也可能是接口抽风，
  // 这时候把整库标成 missing 反而让用户以为书没了
  let missing = 0
  if (keepSeries.length > 0) {
    const retired = retireSeriesNotIn(libraryId, keepSeries)
    missing = retired.missing
    if (retired.deletedSeries.length > 0) {
      await removeSeriesArtifacts(retired.deletedSeries, retired.deletedChapters)
    }
    // 书架列表直读 series 表不受影响，但搜索走 series_fts MATCH——
    // 与本地扫描收尾对齐，否则云盘扫出的系列要等下次本地扫描才可搜
    rebuildFts()
  }
  return { series: keepSeries.length, chapters: chapterTotal, missing }
}
