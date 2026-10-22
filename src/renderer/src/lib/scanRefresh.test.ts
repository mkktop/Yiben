import { describe, expect, it, vi } from 'vitest'
import { createScanRefresher } from './scanRefresh'

describe('扫描期间书架节流刷新', () => {
  it('首轮进度立即刷新，间隔内不重复，超间隔再刷', () => {
    const bump = vi.fn()
    let t = 1000
    const refresh = createScanRefresher(bump, 5000, () => t)

    refresh('reading') // 首条立即
    expect(bump).toHaveBeenCalledTimes(1)

    t = 4000
    refresh('reading') // 距上次 3s：不刷
    t = 5999
    refresh('reading') // 距上次 4999ms：不刷
    expect(bump).toHaveBeenCalledTimes(1)

    t = 6000
    refresh('reading') // 距上次 5s：刷
    expect(bump).toHaveBeenCalledTimes(2)
  })

  it('done 无条件刷新并复位：新一轮扫描的首条又是立即刷', () => {
    const bump = vi.fn()
    let t = 1000
    const refresh = createScanRefresher(bump, 5000, () => t)

    refresh('reading')
    t = 2000
    refresh('done') // 终态必刷
    expect(bump).toHaveBeenCalledTimes(2)

    t = 3000
    refresh('reading') // 复位后首条又立即
    expect(bump).toHaveBeenCalledTimes(3)
  })

  it('章节级高频事件被节流，不放大成高频重拉', () => {
    const bump = vi.fn()
    let t = 0
    const refresh = createScanRefresher(bump, 5000, () => t)
    for (let i = 0; i < 500; i++) {
      t += 100 // 模拟 50 秒内 500 条章节级进度
      refresh('reading')
    }
    // 0s 立即一次 + 每 5s 一次 → 约 11 次，远小于事件数
    expect(bump.mock.calls.length).toBeLessThanOrEqual(12)
    expect(bump).toHaveBeenCalled()
  })
})
