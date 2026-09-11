import { describe, expect, it } from 'vitest'
import { backoffDelay, chapterGapMs } from './backoff'

describe('backoffDelay（指数退避 + 抖动）', () => {
  it('随次数递增且封顶 60s', () => {
    const d0 = backoffDelay(0)
    const d2 = backoffDelay(2)
    const d9 = backoffDelay(9)
    expect(d0).toBeGreaterThanOrEqual(4000) // 5s × 0.8
    expect(d0).toBeLessThanOrEqual(6000) // 5s × 1.2
    expect(d2).toBeGreaterThanOrEqual(12000) // 45s × 0.8
    expect(d2).toBeLessThanOrEqual(54000)
    expect(d9).toBeLessThanOrEqual(72000) // 60s × 1.2
  })

  it('带随机抖动（多次调用值不全相同）', () => {
    const values = new Set(Array.from({ length: 20 }, () => backoffDelay(0)))
    expect(values.size).toBeGreaterThan(1)
  })
})

describe('chapterGapMs（章节间停顿）', () => {
  it('在 2–5 秒之间', () => {
    for (let i = 0; i < 50; i++) {
      const gap = chapterGapMs()
      expect(gap).toBeGreaterThanOrEqual(2000)
      expect(gap).toBeLessThanOrEqual(5000)
    }
  })
})
