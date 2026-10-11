import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  library: vi.fn(),
  scan: vi.fn(),
  broadcast: vi.fn()
}))
vi.mock('./db', () => ({ getLibrary: mocks.library }))
vi.mock('./scanner', () => ({ scanLibrary: mocks.scan }))
vi.mock('./cloud189/scanner', () => ({ scanCloudLibrary: vi.fn() }))
vi.mock('./cloud115/scanner', () => ({ scan115Library: vi.fn() }))
vi.mock('./webdav/scanner', () => ({ scanWebDavLibrary: vi.fn() }))
vi.mock('./events', () => ({ broadcast: mocks.broadcast }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.library.mockImplementation((id: number) => ({ id, kind: 'local' }))
  mocks.scan.mockResolvedValue({ series: 1, chapters: 1 })
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('扫描排队与互斥', () => {
  it('独占扫描结束后继续排队任务，同库等待请求合并', async () => {
    const { runExclusiveScan, queueRescan } = await import('./rescan')
    const gate = deferred()
    const running = runExclusiveScan(() => gate.promise)
    const queued = queueRescan(1)
    queueRescan(1)
    await Promise.resolve()
    expect(mocks.scan).not.toHaveBeenCalled()
    gate.resolve()
    await running
    await queued
    expect(mocks.scan).toHaveBeenCalledTimes(1)
  })

  it('同库扫描期间再有变更，追加一轮并合并重复等待请求', async () => {
    const { queueRescan } = await import('./rescan')
    const gate = deferred()
    const blocker = deferred()
    mocks.scan.mockImplementationOnce(() => gate.promise.then(() => ({ series: 1, chapters: 1 })))
    mocks.scan.mockImplementationOnce(() =>
      blocker.promise.then(() => ({ series: 1, chapters: 1 }))
    )
    const first = queueRescan(1)
    await Promise.resolve()
    expect(mocks.scan).toHaveBeenCalledTimes(1)
    queueRescan(2)
    const again = queueRescan(1)
    gate.resolve()
    await first
    queueRescan(1)
    blocker.resolve()
    await again
    expect(mocks.scan.mock.calls.map((args) => args[0])).toEqual([1, 2, 1])
  })

  it('等待超过旧的 60 秒限制，任务仍在释放锁后执行', async () => {
    vi.useFakeTimers()
    try {
      const { runExclusiveScan, queueRescan } = await import('./rescan')
      const gate = deferred()
      const running = runExclusiveScan(() => gate.promise)
      const queued = queueRescan(1)
      await vi.advanceTimersByTimeAsync(120_000)
      expect(mocks.scan).not.toHaveBeenCalled()
      gate.resolve()
      await running
      await queued
      expect(mocks.scan).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('失败释放互斥并广播终态，后续书库继续扫描', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { queueRescan, isScanning } = await import('./rescan')
      mocks.scan.mockRejectedValueOnce(new Error('扫描失败'))
      queueRescan(1)
      await queueRescan(2)
      expect(mocks.scan.mock.calls.map((args) => args[0])).toEqual([1, 2])
      expect(isScanning()).toBe(false)
      expect(mocks.broadcast).toHaveBeenCalledWith('scan:progress', { libraryId: 1, phase: 'done' })
    } finally {
      warn.mockRestore()
    }
  })

  it('等待时移除的书库不再扫描', async () => {
    const { runExclusiveScan, queueRescan } = await import('./rescan')
    const gate = deferred()
    const running = runExclusiveScan(() => gate.promise)
    const queued = queueRescan(1)
    mocks.library.mockReturnValue(undefined)
    gate.resolve()
    await running
    await queued
    expect(mocks.scan).not.toHaveBeenCalled()
  })
  it('文件关联的独占任务可以排队，不与在途扫描并发', async () => {
    const { runExclusiveScan, isScanning } = await import('./rescan')
    const gate = deferred(),
      file = vi.fn(async () => '文件已打开')
    const scanning = runExclusiveScan(() => gate.promise)
    const opening = runExclusiveScan(file, true)
    await Promise.resolve()
    expect(file).not.toHaveBeenCalled()
    gate.resolve()
    await scanning
    expect(await opening).toBe('文件已打开')
    expect(isScanning()).toBe(false)
  })
})
