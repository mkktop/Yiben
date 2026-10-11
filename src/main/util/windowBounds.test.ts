import { describe, expect, it } from 'vitest'
import { restoredContentSize } from './windowBounds'

describe('窗口内容尺寸恢复', () => {
  it('使用当前外框差值，而不是假定保存值中的系统边框像素', () => {
    const saved = { width: 1280, height: 820 }
    expect(restoredContentSize(saved, { width: 1284, height: 823 }, { width: 1282, height: 821 }))
      .toEqual({ width: 1278, height: 818 })
    expect(restoredContentSize(saved, { width: 1286, height: 824 }, { width: 1282, height: 823 }))
      .toEqual({ width: 1276, height: 819 })
    expect(saved).toEqual({ width: 1280, height: 820 })
  })

  it('没有外框差值时保持保存尺寸', () => {
    expect(restoredContentSize({ width: 960, height: 640 }, { width: 960, height: 640 }, { width: 960, height: 640 }))
      .toEqual({ width: 960, height: 640 })
  })

  it('交给窗口最小尺寸约束时仍保持正数', () => {
    expect(restoredContentSize({ width: 2, height: 2 }, { width: 6, height: 6 }, { width: 2, height: 2 }))
      .toEqual({ width: 1, height: 1 })
  })
})
