import { describe, expect, it, vi } from 'vitest'
import { activateModalFocus, handleModalKeyDown, modalFocusableElements } from './modalFocus'

// 用精简宿主对象验证键盘与焦点规则；实际浏览器布局另由 Electron 回归覆盖。
function fixture() {
  const listeners = new Set<() => void>()
  const document = {
    activeElement: null as Element | null,
    defaultView: { getComputedStyle: (element: { visibility: string }) => ({ visibility: element.visibility }) },
    addEventListener: (_name: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_name: string, listener: () => void) => listeners.delete(listener)
  }
  const control = (options: { disabled?: boolean; hidden?: boolean; tabIndex?: number; preferred?: boolean; visibility?: string } = {}) => {
    const item = {
      tabIndex: options.tabIndex ?? 0,
      disabled: options.disabled ?? false,
      hidden: options.hidden ?? false,
      preferred: options.preferred ?? false,
      visibility: options.visibility ?? 'visible',
      isConnected: true,
      ownerDocument: document,
      matches: (selector: string) => selector === ':disabled' ? item.disabled : item.preferred,
      closest: () => item.hidden ? item : null,
      getClientRects: () => item.hidden ? [] : [{}],
      focus: vi.fn(() => {
        document.activeElement = item as unknown as HTMLElement
        listeners.forEach((listener) => listener())
      })
    }
    return item
  }
  const makeRoot = (...controls: ReturnType<typeof control>[]) => {
    const element = control({ tabIndex: -1 })
    const root = {
      ...element,
      querySelectorAll: () => controls,
      contains: (candidate: Element | null) => candidate === root as unknown as Element || controls.includes(candidate as unknown as ReturnType<typeof control>),
      focus: vi.fn(() => {
        document.activeElement = root as unknown as HTMLElement
        listeners.forEach((listener) => listener())
      })
    }
    return root as unknown as HTMLElement
  }
  const event = (key: string, shiftKey = false) => ({ key, shiftKey, preventDefault: vi.fn(), stopPropagation: vi.fn() })
  return { control, makeRoot, document, event }
}

describe('弹窗焦点与键盘', () => {
  it('进入弹窗时优先明确指定的控件，关闭后恢复触发按钮', () => {
    const { control, makeRoot, document } = fixture()
    const trigger = control()
    trigger.focus()
    const close = control()
    const input = control({ preferred: true })
    const root = makeRoot(close, input)
    const restore = activateModalFocus(root)
    expect(document.activeElement).toBe(input)
    restore()
    expect(document.activeElement).toBe(trigger)
  })

  it('保留已经进入弹窗的 autofocus 焦点，外部抢焦点会回到弹窗', () => {
    const { control, makeRoot, document } = fixture()
    const first = control()
    const input = control()
    const root = makeRoot(first, input)
    input.focus()
    const restore = activateModalFocus(root)
    expect(document.activeElement).toBe(input)
    control().focus()
    expect(document.activeElement).toBe(first)
    restore()
  })

  it('Tab 与 Shift+Tab 只在两端环绕，保留中间控件的默认移动', () => {
    const { control, makeRoot, document, event } = fixture()
    const first = control()
    const middle = control()
    const last = control()
    const root = makeRoot(first, middle, last)
    last.focus()
    const forward = event('Tab')
    handleModalKeyDown(forward, root, vi.fn(), false)
    expect(forward.preventDefault).toHaveBeenCalled()
    expect(document.activeElement).toBe(first)
    const reverse = event('Tab', true)
    handleModalKeyDown(reverse, root, vi.fn(), false)
    expect(document.activeElement).toBe(last)
    middle.focus()
    const natural = event('Tab')
    handleModalKeyDown(natural, root, vi.fn(), false)
    expect(natural.preventDefault).not.toHaveBeenCalled()
  })

  it('动态禁用、隐藏及负 tabindex 控件不参与焦点循环', () => {
    const { control, makeRoot } = fixture()
    const disabled = control({ disabled: true })
    const hidden = control({ hidden: true })
    const unfocusable = control({ tabIndex: -1 })
    const invisible = control({ visibility: 'hidden' })
    const active = control()
    const root = makeRoot(disabled, hidden, unfocusable, invisible, active)
    expect(modalFocusableElements(root)).toEqual([active])
    disabled.disabled = false
    expect(modalFocusableElements(root)).toEqual([disabled, active])
  })

  it('无可用控件时焦点留在弹窗；Esc 可关闭且 busy 时不会泄露给页面', () => {
    const { makeRoot, document, event } = fixture()
    const root = makeRoot()
    const restore = activateModalFocus(root)
    const tab = event('Tab')
    const close = vi.fn()
    handleModalKeyDown(tab, root, close, false)
    expect(document.activeElement).toBe(root)
    const escape = event('Escape')
    handleModalKeyDown(escape, root, close, true)
    expect(close).not.toHaveBeenCalled()
    expect(escape.preventDefault).toHaveBeenCalled()
    expect(escape.stopPropagation).toHaveBeenCalled()
    handleModalKeyDown(event('Escape'), root, close, false)
    expect(close).toHaveBeenCalledOnce()
    const input = event('Enter')
    handleModalKeyDown(input, root, close, false)
    expect(input.stopPropagation).toHaveBeenCalled()
    expect(input.preventDefault).not.toHaveBeenCalled()
    restore()
  })

  it('叠加弹窗只约束顶层，退出后依次恢复焦点', () => {
    const { control, makeRoot, document } = fixture()
    const trigger = control()
    trigger.focus()
    const outerButton = control()
    const closeOuter = activateModalFocus(makeRoot(outerButton))
    const innerButton = control()
    const closeInner = activateModalFocus(makeRoot(innerButton))
    expect(document.activeElement).toBe(innerButton)
    outerButton.focus()
    expect(document.activeElement).toBe(innerButton)
    closeInner()
    expect(document.activeElement).toBe(outerButton)
    closeOuter()
    expect(document.activeElement).toBe(trigger)
  })

  it('操作移除原入口后，关闭回到明确的页面标题', () => {
    const { control, makeRoot, document } = fixture()
    const trigger = control()
    const title = control({ tabIndex: -1 })
    trigger.focus()
    const restore = activateModalFocus(makeRoot(control()), () => title as unknown as HTMLElement)
    trigger.isConnected = false
    restore()
    expect(document.activeElement).toBe(title)
  })

  it('清理后原入口禁用时使用回退，取消时仍优先原入口', () => {
    const { control, makeRoot, document } = fixture()
    const trigger = control()
    const title = control({ tabIndex: -1 })
    trigger.focus()
    const cancelled = activateModalFocus(makeRoot(control()), () => title as unknown as HTMLElement)
    cancelled()
    expect(document.activeElement).toBe(trigger)
    expect(title.focus).not.toHaveBeenCalled()
    const confirmed = activateModalFocus(makeRoot(control()), () => title as unknown as HTMLElement)
    trigger.disabled = true
    confirmed()
    expect(document.activeElement).toBe(title)
  })

  it('叠加弹窗的回退不能跳到仍在打开的外层弹窗之外', () => {
    const { control, makeRoot, document } = fixture()
    const trigger = control()
    const title = control({ tabIndex: -1 })
    trigger.focus()
    const outerButton = control()
    const outer = makeRoot(outerButton)
    const closeOuter = activateModalFocus(outer)
    const closeInner = activateModalFocus(makeRoot(control()), () => title as unknown as HTMLElement)
    outerButton.disabled = true
    closeInner()
    expect(title.focus).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(outer)
    closeOuter()
    expect(document.activeElement).toBe(trigger)
  })
})
