import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CloudEntry } from '../cloud115/parsing'

vi.mock('../db', () => ({
  getLibrary: vi.fn(() => ({ name: '测试库' })),
  upsertSeries: vi.fn(() => 1),
  upsertChapter: vi.fn(() => 1),
  replaceChapterPages: vi.fn(),
  deleteChaptersNotIn: vi.fn(() => []),
  retireSeriesNotIn: vi.fn(() => ({ missing: 0, deletedSeries: [], deletedChapters: [] })),
  rebuildFts: vi.fn(),
  getChapterMetaIfUnchanged: vi.fn(() => null),
  seriesPathExists: vi.fn(() => false)
}))
vi.mock('../thumbnail', () => ({ removeSeriesArtifacts: vi.fn() }))
vi.mock('../pageThumb', () => ({ removePageThumbs: vi.fn() }))

import { rebuildFts, getChapterMetaIfUnchanged, upsertChapter, seriesPathExists } from '../db'
import { scanCloudLibrary, type CloudScanProgress } from './scanner'

type LogItem = ['list', string] | ['progress', CloudScanProgress]

/** dir(id) 目录 + img(id) 单图，构造最小云盘树 */
const dir = (id: string, mtime?: number): CloudEntry => ({ id, name: id, size: 0, isDir: true, mtime })
const img = (id: string): CloudEntry => ({ id, name: `${id}.jpg`, size: 1, isDir: false })

/**
 * wrapper 目录（全子目录且每个子目录含图）→ 归为一个系列
 * series 目录（混有非压缩包文件）→ 独立作品
 */
const TREE: Record<string, CloudEntry[]> = {
  root: [dir('w'), dir('s'), { id: 'z', name: '单行.zip', size: 9, isDir: false }],
  w: [dir('w1'), dir('w2')],
  w1: [img('a')],
  w2: [img('b')],
  s: [dir('s1'), { id: 'n', name: '说明.txt', size: 1, isDir: false }],
  s1: [img('c')]
}

const deps = (folderId = 'root') => ({
  libraryId: 7,
  cloudFolderId: folderId,
  listAll: vi.fn(async (id: string) => TREE[id] ?? []),
  cacheDir: () => '/cache',
  scheme: 'cloud189'
})

const run = async (tree: Record<string, CloudEntry[]>) => {
  const log: LogItem[] = []
  const d = deps()
  d.listAll.mockImplementation(async (id: string) => {
    log.push(['list', id])
    return tree[id] ?? []
  })
  await scanCloudLibrary(d, (p) => log.push(['progress', p]))
  return log
}

beforeEach(() => vi.clearAllMocks())

describe('云端扫描进度事件', () => {
  it('多系列：先发启动事件再联网，分类 i/N，标题细化到章，收尾重建搜索索引', async () => {
    const log = await run(TREE)
    const events = log.filter((x) => x[0] === 'progress').map((x) => x[1])

    // 扫出了系列就必须重建 FTS，否则云盘系列在搜索里永远缺席
    expect(rebuildFts).toHaveBeenCalled()

    // 启动事件必须是第一条日志（先于根目录的任何网络列举），浮标才能立刻出现
    expect(log[0]).toEqual(['progress', { libraryId: 7, current: 0, total: 0, title: '正在读取云端目录', phase: 'reading' }])
    expect(log[1]).toEqual(['list', 'root'])

    // 分类阶段：总数已知（根目录数），逐个报目录名
    const classify = events.filter((e) => e.title.startsWith('分析目录'))
    expect(classify).toEqual([
      { libraryId: 7, current: 0, total: 2, title: '分析目录：w', phase: 'reading' },
      { libraryId: 7, current: 1, total: 2, title: '分析目录：s', phase: 'reading' }
    ])

    // 系列内部：进度条口径仍是系列 i/N，标题细化到章（wrapper 两卷都报，单章系列不报）
    const step = events.filter((e) => e.title.includes('（'))
    expect(step).toEqual([
      { libraryId: 7, current: 0, total: 3, title: 'w（1/2）', phase: 'reading' },
      { libraryId: 7, current: 0, total: 3, title: 'w（2/2）', phase: 'reading' }
    ])

    // 每个系列开工前有 series 级事件，final 终态 done 不由管线发出（rescan 统一收尾）
    const seriesStarts = events.filter((e) => !e.title.startsWith('分析目录') && !e.title.includes('（') && e.title !== '正在读取云端目录' && e.title !== '云端目录')
    expect(seriesStarts).toEqual([
      { libraryId: 7, current: 0, total: 3, title: 'w', phase: 'reading' },
      { libraryId: 7, current: 1, total: 3, title: 's', phase: 'reading' },
      { libraryId: 7, current: 2, total: 3, title: '单行', phase: 'reading' }
    ])
    expect(events.every((e) => e.phase === 'reading')).toBe(true)
  })

  it('单系列：章节序号直接当进度计数', async () => {
    const log = await run({ root: [dir('v1'), dir('v2')], v1: [img('a')], v2: [img('b')] })
    const events = log.filter((x) => x[0] === 'progress').map((x) => x[1])
    expect(events.slice(-3)).toEqual([
      { libraryId: 7, current: 0, total: 1, title: '云端目录', phase: 'reading' },
      { libraryId: 7, current: 0, total: 2, title: '测试库（1/2）', phase: 'reading' },
      { libraryId: 7, current: 1, total: 2, title: '测试库（2/2）', phase: 'reading' }
    ])
  })

  it('增量：全命中时分类不下钻、章节不再列举（根+根目录两轮列表即完成）', async () => {
    // 单系列布局：根系列已入库，ch1/ch2 都是库内已验证章节（mtime 5000/6000 各自命中）
    vi.mocked(seriesPathExists).mockReturnValue(true)
    vi.mocked(getChapterMetaIfUnchanged).mockImplementation(
      (_p, _s, m) => (m === 5000 ? 3 : m === 6000 ? 2 : null)
    )
    const log = await run({
      root: [dir('w')],
      w: [dir('ch1', 5000), dir('ch2', 6000)],
      ch1: [img('a')],
      ch2: [img('b')]
    })
    const listed = log.filter((x) => x[0] === 'list').map((x) => x[1])
    // wrapper 探测跳过下钻 + writeSeries 章节命中跳过 → 只有根与 w 两轮列表
    expect(listed).toEqual(['root', 'w'])
    // 命中章节沿用库内页数并回写 mtime
    const reused = vi
      .mocked(upsertChapter)
      .mock.calls.map((c) => c[0])
      .find((p) => String(p.path).includes('f-ch1'))
    expect(reused?.page_count).toBe(3)
    expect(reused?.mtime).toBe(5000)
  })

  it('增量：mtime 变化的子目录仍下钻重列；多系列布局不受增量影响', async () => {
    vi.mocked(seriesPathExists).mockReturnValue(true)
    vi.mocked(getChapterMetaIfUnchanged).mockImplementation((_p, _s, m) => (m === 5000 ? 3 : null))
    // ch1 命中、ch2 的 mtime 已变（9999 对不上）→ wrapper 探测仍要列子目录
    const log1 = await run({
      root: [dir('w')],
      w: [dir('ch1', 5000), dir('ch2', 9999)],
      ch1: [img('a')],
      ch2: [img('b')]
    })
    expect(log1.filter((x) => x[0] === 'list').map((x) => x[1])).toEqual(['root', 'w', 'ch1', 'ch2'])

    // 多系列布局：根系列不在库 → 即便子目录全命中也按原逻辑下钻判定
    vi.mocked(seriesPathExists).mockReturnValue(false)
    const log2 = await run({
      root: [dir('w2')],
      w2: [dir('ch1', 5000), dir('ch2', 6000)],
      ch1: [img('a')],
      ch2: [img('b')]
    })
    expect(log2.filter((x) => x[0] === 'list').map((x) => x[1])).toEqual(['root', 'w2', 'ch1', 'ch2'])
  })
})
