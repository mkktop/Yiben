import { describe, expect, it } from 'vitest'
import { parseByteRange } from './httpRange'
describe('文件字节范围', () => {
  it('支持闭区间、开放尾部和后缀，并钳位文件末尾', () => {
    expect(parseByteRange(null, 10)).toBeNull()
    expect(parseByteRange('bytes=2-4', 10)).toEqual({ start: 2, end: 4 })
    expect(parseByteRange('bytes=3-', 10)).toEqual({ start: 3, end: 9 })
    expect(parseByteRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 })
    expect(parseByteRange('bytes=2-999', 10)).toEqual({ start: 2, end: 9 })
  })
  it.each([
    'bytes=10-',
    'bytes=3-2',
    'bytes=-0',
    'bytes=-',
    'bytes=0-1,3-4',
    'bytes=9007199254740992-'
  ])('拒绝无效范围 %s', (range) => {
    expect(parseByteRange(range, 10)).toBe(false)
  })
})
