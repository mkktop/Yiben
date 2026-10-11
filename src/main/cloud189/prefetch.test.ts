import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OfflineStatus } from '../../shared/types'
const mock = vi.hoisted(() => ({
  broadcast: vi.fn(),
  local: vi.fn(),
  page: vi.fn(),
  status: vi.fn(),
  pin: vi.fn(),
  chapters: vi.fn()
}))
vi.mock('../db', () => ({
  getSeries: () => ({ id: 1, library_id: 1 }),
  getLibrary: () => ({ kind: 'webdav' }),
  chaptersBySeries: mock.chapters,
  getChapterPageFile: () => null
}))
vi.mock('./ensure', () => ({ ensureChapterPage: mock.page, ensureLocalChapterPath: mock.local }))
vi.mock('./client', () => ({ noteCloudError: () => null }))
vi.mock('./offline', () => ({ offlineStatus: mock.status, setOfflinePinned: mock.pin }))
vi.mock('./cache', () => ({ cacheMaintenanceActive: () => false }))
vi.mock('../events', () => ({ broadcast: mock.broadcast }))
vi.mock('../util/backoff', () => ({
  backoffDelay: () => 0,
  chapterGapMs: () => 0,
  sleep: async () => {}
}))
import { startPrefetch, cancelPrefetch, prefetchRunning } from './prefetch'
const partial: OfflineStatus = {
  seriesId: 1,
  total: 2,
  complete: 0,
  bytes: 0,
  requiredBytes: 2,
  missing: ['第1话', '第2话'],
  pinned: false,
  capacityExceeded: false
}
const finished = (): Record<string, unknown> | undefined =>
  mock.broadcast.mock.calls.find((args) => args[0] === 'prefetch:done')?.[1]
beforeEach(() => {
  vi.clearAllMocks()
  mock.local.mockReset()
  mock.local.mockResolvedValue('已缓存')
  mock.chapters.mockReturnValue(
    [1, 2].map((id) => ({
      id,
      kind: 'zip',
      title: `第${id}话`,
      path: `D:/不存在的预取测试/${id}.zip`,
      cloud_file_id: String(id),
      size: 1,
      page_count: 1
    }))
  )
  mock.status.mockReset()
  mock.status.mockResolvedValue(partial)
})
describe('预取任务与离线状态分开核验', () => {
  it('超过配额时不发起下载，发出可恢复错误并收尾', async () => {
    mock.status.mockResolvedValue({ ...partial, capacityExceeded: true })
    startPrefetch(1)
    await vi.waitFor(() => expect(finished()).toBeDefined())
    expect(mock.local).not.toHaveBeenCalled()
    expect(mock.pin).not.toHaveBeenCalled()
    expect(finished()?.error).toContain('缓存上限')
    expect(prefetchRunning()).toEqual([])
  })
  it('失败章节重试后继续其他章节，结束仍携带真实完整性而非假完成', async () => {
    mock.local.mockImplementation(async (id: number) => {
      if (id === 1) throw new Error('临时网络错误')
      return '已缓存'
    })
    mock.status
      .mockResolvedValueOnce(partial)
      .mockResolvedValue({ ...partial, complete: 1, missing: ['第1话'] })
    startPrefetch(1)
    await vi.waitFor(() => expect(finished()).toBeDefined())
    expect(mock.local.mock.calls.map((args) => args[0])).toEqual([1, 1, 1, 2])
    expect(finished()?.failed).toEqual(['第1话'])
    expect((finished()?.offline as OfflineStatus).complete).toBe(1)
  })
  it('取消中断在途下载，不启动后续章节，也能重新发起任务', async () => {
    mock.local.mockImplementationOnce(
      async (_id: number, signal: AbortSignal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        )
    )
    startPrefetch(1)
    await vi.waitFor(() => expect(mock.local).toHaveBeenCalledTimes(1))
    expect(cancelPrefetch(1)).toBe(true)
    await vi.waitFor(() => expect(finished()).toBeDefined())
    expect(finished()?.cancelled).toBe(true)
    expect(finished()?.error).toBeUndefined()
    expect(mock.local).toHaveBeenCalledTimes(1)
    expect(prefetchRunning()).toEqual([])
    expect(() => startPrefetch(1)).not.toThrow()
    await vi.waitFor(() => expect(prefetchRunning()).toEqual([]))
  })
})
