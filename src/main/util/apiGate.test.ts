import { describe, expect, it } from 'vitest'
import { MinIntervalChain } from './apiGate'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('MinIntervalChain（网盘 API 限流队列）', () => {
  it('串行执行：前一个完成前下一个不开始', async () => {
    const order: string[] = []
    const chain = new MinIntervalChain(0)
    const p1 = chain.run(async () => {
      order.push('a-start')
      await sleep(30)
      order.push('a-end')
    })
    const p2 = chain.run(async () => {
      order.push('b-start')
      await sleep(5)
      order.push('b-end')
    })
    await Promise.all([p1, p2])
    // b 必须在 a 结束之后才开始（旧实现只串行间隔检查时 b 会立刻开始）
    expect(order.indexOf('b-start')).toBeGreaterThan(order.indexOf('a-end'))
  })

  it('失败不阻断后续任务，也不吞掉调用方的错误', async () => {
    const chain = new MinIntervalChain(0)
    const boom = chain.run(() => Promise.reject(new Error('boom')))
    const ok = chain.run(async () => 'ok')
    await expect(boom).rejects.toThrow('boom')
    await expect(ok).resolves.toBe('ok')
  })

  it('完成后至少间隔 intervalMs 才发起下一个', async () => {
    const interval = 120
    const chain = new MinIntervalChain(interval)
    const startedAt: number[] = []
    const job = (): Promise<void> =>
      chain.run(async () => {
        startedAt.push(Date.now())
      })
    await job()
    const before = Date.now()
    await job()
    expect(startedAt.length).toBe(2)
    // 第二次发起与第一次完成之间至少隔了 interval（留 20ms 计时余量）
    expect(startedAt[1]! - before).toBeGreaterThanOrEqual(interval - 20)
  })
})
