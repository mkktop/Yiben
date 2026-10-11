import { describe, expect, it } from 'vitest'
import { normalizeReaderPrefs } from '../../shared/readerPrefs'
import type { ReaderPrefs } from '../../shared/types'
describe('恢复和 IPC 阅读偏好的容错', () => {
  it('保留关闭值与零滤镜，不误回退为默认开启', () => {
    expect(
      normalizeReaderPrefs({ enhance: false, rtl: false, sharpness: 0, warmth: 0, brightness: 0.8 })
    ).toEqual({ enhance: false, rtl: false, sharpness: 0, warmth: 0, brightness: 0.8 })
  })
  it('异常对象与非法枚举不会进入阅读器，有限数值落在可显示范围', () => {
    expect(normalizeReaderPrefs(null as unknown as ReaderPrefs)).toEqual({})
    expect(
      normalizeReaderPrefs({
        mode: 'bad',
        brightness: -1,
        warmth: Infinity,
        contrast: NaN,
        rotate: 33,
        rtl: 'yes'
      } as unknown as ReaderPrefs)
    ).toEqual({ brightness: 0.3 })
  })
})
