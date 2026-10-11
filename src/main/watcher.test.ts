import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ watch: vi.fn(), queue: vi.fn(), broadcast: vi.fn() }))
vi.mock('chokidar', () => ({ watch: mocks.watch }))
vi.mock('./db', () => ({ listLibraries: () => [
  { id: 1, kind: 'local', path: 'D:/local' }, { id: 2, kind: '115', path: '115://1' }
] }))
vi.mock('./rescan', () => ({ queueRescan: mocks.queue }))
vi.mock('./events', () => ({ broadcast: mocks.broadcast }))
import { startWatchers, stopWatchers } from './watcher'

let watcher: EventEmitter & { close: ReturnType<typeof vi.fn> }
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  watcher = Object.assign(new EventEmitter(), { close: vi.fn().mockResolvedValue(undefined) })
  mocks.watch.mockReturnValue(watcher)
})
afterEach(() => { stopWatchers(); vi.useRealTimers() })

describe('本地文件监听', () => {
  it('只监听本地库，连续变动去抖后交给扫描队列', async () => {
    startWatchers()
    expect(mocks.watch).toHaveBeenCalledTimes(1)
    watcher.emit('add')
    await vi.advanceTimersByTimeAsync(4000)
    watcher.emit('change')
    await vi.advanceTimersByTimeAsync(4000)
    expect(mocks.queue).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.queue).toHaveBeenCalledWith(1)
  })

  it('停止监听同时取消待执行重扫', async () => {
    startWatchers()
    watcher.emit('unlink')
    stopWatchers()
    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.queue).not.toHaveBeenCalled()
    expect(watcher.close).toHaveBeenCalledOnce()
  })

  it('监听失败推送可读提示，不产生未处理的 error 事件', () => {
    startWatchers()
    expect(() => watcher.emit('error', new Error('目录不可用'))).not.toThrow()
    expect(mocks.broadcast).toHaveBeenCalledWith('scan:notice', {
      libraryId: 1, level: 'warn', message: '书库文件监听失败，请手动重扫：目录不可用'
    })
  })
})
