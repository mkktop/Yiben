import { describe, expect, it } from 'vitest'
import { waitWithAbort } from './abort'
import { sleep } from './backoff'
describe('取消独立等待', () => {
  it('搭车者取消不影响共用下载的所有者', async () => {
    let resolve!: (value: number) => void
    const shared = new Promise<number>((done) => {
      resolve = done
    })
    const controller = new AbortController()
    const joined = waitWithAbort(shared, controller.signal)
    controller.abort(new Error('用户取消'))
    await expect(joined).rejects.toThrow('用户取消')
    resolve(42)
    expect(await shared).toBe(42)
  })
  it('退避期间取消立即结束，无需等待定时器', async () => {
    const controller = new AbortController()
    const started = Date.now(),
      waiting = sleep(30000, controller.signal)
    controller.abort(new Error('取消等待'))
    await expect(waiting).rejects.toThrow('取消等待')
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
