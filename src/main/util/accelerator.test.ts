import { describe, expect, it } from 'vitest'
import { isValidAccelerator } from './accelerator'

describe('isValidAccelerator', () => {
  it('空串 = 自动，合法', () => {
    expect(isValidAccelerator('')).toBe(true)
  })

  it('内置候选与常见组合合法', () => {
    expect(isValidAccelerator('Alt+X')).toBe(true)
    expect(isValidAccelerator('Control+Alt+X')).toBe(true)
    expect(isValidAccelerator('Control+Shift+Y')).toBe(true)
    expect(isValidAccelerator('Alt+[')).toBe(true)
    expect(isValidAccelerator('Control+Space')).toBe(true)
    expect(isValidAccelerator('Control+PageDown')).toBe(true)
  })

  it('F 功能键可裸按', () => {
    expect(isValidAccelerator('F9')).toBe(true)
    expect(isValidAccelerator('F24')).toBe(true)
  })

  it('裸键 / 纯 Shift 组合必须拒绝（会被系统级劫持成打字键）', () => {
    expect(isValidAccelerator('X')).toBe(false)
    expect(isValidAccelerator('Shift+X')).toBe(false)
    expect(isValidAccelerator('Shift+F1')).toBe(true) // F 键例外
  })

  it('结构不合法', () => {
    expect(isValidAccelerator('X+Control')).toBe(false) // 主键必须是最后一段
    expect(isValidAccelerator('Control')).toBe(false) // 只有修饰键
    expect(isValidAccelerator('Control+Control+X')).toBe(false) // 重复修饰键
    expect(isValidAccelerator('Meta+X')).toBe(false) // 主键无 Ctrl/Alt 不放行
    expect(isValidAccelerator('Ctrl+VolumeUp')).toBe(false) // 白名单外的具名键
    expect(isValidAccelerator('Control+Control')).toBe(false)
    expect(isValidAccelerator('Capslock+X')).toBe(false)
  })

  it('非字符串/越界 F 键拒绝', () => {
    expect(isValidAccelerator(null)).toBe(false)
    expect(isValidAccelerator(42)).toBe(false)
    expect(isValidAccelerator('F25')).toBe(false)
  })
})
