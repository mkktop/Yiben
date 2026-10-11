import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readDir: vi.fn(), retire: vi.fn(), rebuild: vi.fn(), relocate: vi.fn()
}))
vi.mock('../db', () => ({
  getLibrary: () => ({ id: 1, path: 'D:/scan-test' }),
  retireSeriesNotIn: mocks.retire,
  rebuildFts: mocks.rebuild,
  countByLibrary: () => ({ series: 2, chapters: 0 })
}))
vi.mock('../util/paths', async (importOriginal) => ({
  ...await importOriginal<typeof import('../util/paths')>(),
  readDirEntries: mocks.readDir
}))
vi.mock('../archives', () => ({}))
vi.mock('./relocate', () => ({ adoptRelocatedSeries: mocks.relocate }))
vi.mock('../thumbnail', () => ({}))
vi.mock('../pageThumb', () => ({}))

import { scanLibrary } from './index'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.retire.mockReturnValue({ missing: 0, deletedSeries: [], deletedChapters: [] })
  mocks.relocate.mockReturnValue(0)
})

describe('本地并行扫描收尾', () => {
  it('一路失败时等待另外的 worker 收尾，且不做删除/失踪对账', async () => {
    let finish!: (entries: []) => void
    const slow = new Promise<[]>((resolve) => { finish = resolve })
    const error = new Error('目录读取失败')
    mocks.readDir.mockImplementation((path: string) => {
      if (path === 'D:/scan-test') return Promise.resolve([
        { name: '失败目录', isDir: true }, { name: '慢目录', isDir: true }
      ])
      if (path.endsWith('失败目录')) return Promise.reject(error)
      return slow
    })
    let settled = false
    const outcome = scanLibrary(1).then(
      () => { settled = true; return null },
      (err) => { settled = true; return err }
    )
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(mocks.readDir).toHaveBeenCalledTimes(3)
    expect(settled).toBe(false)
    expect(mocks.retire).not.toHaveBeenCalled()
    finish([])
    expect(await outcome).toBe(error)
    expect(mocks.retire).not.toHaveBeenCalled()
    expect(mocks.rebuild).not.toHaveBeenCalled()
    expect(mocks.relocate).not.toHaveBeenCalled()
  })

  it('全部 worker 成功后才对账并广播完成', async () => {
    mocks.readDir.mockResolvedValueOnce([
      { name: '空系列一', isDir: true }, { name: '空系列二', isDir: true }
    ]).mockResolvedValue([])
    const progress = vi.fn()
    expect(await scanLibrary(1, progress)).toMatchObject({ libraryId: 1, series: 2 })
    expect(mocks.retire).toHaveBeenCalledOnce()
    expect(mocks.retire.mock.calls[0][1]).toHaveLength(2)
    expect(progress).toHaveBeenLastCalledWith({ libraryId: 1, phase: 'done', current: 2, total: 2 })
  })

  it('根目录不可读取时不做任何对账', async () => {
    mocks.readDir.mockRejectedValueOnce(new Error('移动硬盘未挂载'))
    await expect(scanLibrary(1)).rejects.toThrow('移动硬盘未挂载')
    expect(mocks.retire).not.toHaveBeenCalled()
  })
})
