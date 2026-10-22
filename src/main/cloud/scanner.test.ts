import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CloudEntry } from '../cloud115/parsing'

vi.mock('../db', () => ({
  getLibrary: vi.fn(() => ({ name: '测试库' })),
  upsertSeries: vi.fn(() => 1),
  upsertChapter: vi.fn(() => 1),
  replaceChapterPages: vi.fn(),
  deleteChaptersNotIn: vi.fn(() => []),
  retireSeriesNotIn: vi.fn(() => ({ missing: 0, deletedSeries: [], deletedChapters: [] }))
}))
vi.mock('../thumbnail', () => ({ removeSeriesArtifacts: vi.fn() }))
vi.mock('../pageThumb', () => ({ removePageThumbs: vi.fn() }))

import { scanCloudLibrary, type CloudScanProgress } from './scanner'

type LogItem = ['list', string] | ['progress', CloudScanProgress]

/** dir(id) 目录 + img(id) 单图，构造最小云盘树 */
const dir = (id: string): CloudEntry => ({ id, name: id, size: 0, isDir: true })
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
  it('多系列：先发启动事件再联网，分类 i/N，标题细化到章', async () => {
    const log = await run(TREE)
    const events = log.filter((x) => x[0] === 'progress').map((x) => x[1])

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
})
