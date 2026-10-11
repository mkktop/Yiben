import { describe, expect, it } from 'vitest'
import { acceptReaderShortcut, resolveContinuousStep } from './readerInteractions'

describe('连续阅读键盘导航', () => {
  it('拼接话首页回到路由话末页，目标不受拼接话较短页数限制', () => {
    expect(resolveContinuousStep(0, 3, -1, 10)).toEqual({ kind: 'route-page', page: 9 })
    expect(resolveContinuousStep(1, 3, -1, 10)).toEqual({ kind: 'page', page: 0 })
  })

  it('普通 PDF / 条漫首页和末页保持跨话规则', () => {
    expect(resolveContinuousStep(0, 18, -1)).toEqual({ kind: 'previous-chapter' })
    expect(resolveContinuousStep(17, 18, 1)).toEqual({ kind: 'next-chapter' })
    expect(resolveContinuousStep(8, 18, 1)).toEqual({ kind: 'page', page: 9 })
  })

  it('拼接末页不绕回路由话的下一话，页数未知可继续推进', () => {
    expect(resolveContinuousStep(2, 3, 1, 10)).toEqual({ kind: 'blocked' })
    expect(resolveContinuousStep(12, 0, 1)).toEqual({ kind: 'page', page: 13 })
  })
})

describe('阅读快捷键与原生控件', () => {
  const event = {
    key: ' ',
    defaultPrevented: false,
    isComposing: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false
  }
  it('按钮的空格 / 回车用于激活，空白阅读区域仍可翻页 / 切沉浸', () => {
    expect(acceptReaderShortcut(event, 'control')).toBe(false)
    expect(acceptReaderShortcut({ ...event, key: 'Enter' }, 'control')).toBe(false)
    expect(acceptReaderShortcut(event, 'reading')).toBe(true)
    expect(acceptReaderShortcut({ ...event, key: 'Enter' }, 'reading')).toBe(true)
  })
  it('编辑控件、输入法及系统组合键不能改动阅读状态', () => {
    expect(acceptReaderShortcut({ ...event, key: 'ArrowRight' }, 'editing')).toBe(false)
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'isComposing', 'defaultPrevented'])
      expect(acceptReaderShortcut({ ...event, key: 'e', [modifier]: true }, 'reading')).toBe(false)
    expect(acceptReaderShortcut({ ...event, key: 'E' }, 'reading')).toBe(true)
  })
})
