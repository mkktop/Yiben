import { useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'

const focusableSelector =
  'a[href],button,input,select,textarea,[tabindex],[contenteditable="true"],audio[controls],video[controls],summary'
const modalStack: HTMLElement[] = []

/** 只收集当前可见、可操作的控件，动态加载内容与 busy 状态也会即时生效。 */
export function modalFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => {
    if (
      element.tabIndex < 0 ||
      element.matches(':disabled') ||
      element.closest('[inert],[hidden],[aria-hidden="true"]') ||
      element.getClientRects().length === 0
    )
      return false
    const style = root.ownerDocument.defaultView?.getComputedStyle(element)
    return style?.visibility !== 'hidden' && style?.visibility !== 'collapse'
  })
}

function focusModalStart(root: HTMLElement): void {
  const controls = modalFocusableElements(root)
  const preferred = controls.find((element) => element.matches('[autofocus],[data-autofocus]'))
  ;(preferred ?? controls[0] ?? root).focus({ preventScroll: true })
}

function canRestoreFocus(element: HTMLElement | null | undefined): element is HTMLElement {
  if (!element?.isConnected || element.matches(':disabled') ||
    element.closest('[inert],[hidden],[aria-hidden="true"]') || element.getClientRects().length === 0)
    return false
  const visibility = element.ownerDocument.defaultView?.getComputedStyle(element).visibility
  return visibility !== 'hidden' && visibility !== 'collapse'
}

/** 支持叠加弹窗：仅最上层约束焦点，关闭后恢复触发控件。 */
export function activateModalFocus(root: HTMLElement, fallbackFocus?: () => HTMLElement | null): () => void {
  const document = root.ownerDocument
  const previous = document.activeElement as HTMLElement | null
  modalStack.push(root)
  if (!root.contains(document.activeElement)) focusModalStart(root)

  const containFocus = (): void => {
    if (modalStack.at(-1) === root && !root.contains(document.activeElement)) focusModalStart(root)
  }
  document.addEventListener('focusin', containFocus)
  return () => {
    document.removeEventListener('focusin', containFocus)
    const index = modalStack.lastIndexOf(root)
    const wasTop = index === modalStack.length - 1
    if (index >= 0) modalStack.splice(index, 1)
    if (!wasTop) return
    const remaining = modalStack.at(-1)
    if (canRestoreFocus(previous) && (!remaining || remaining.contains(previous))) {
      previous.focus({ preventScroll: true })
    } else {
      const fallback = fallbackFocus?.()
      if (canRestoreFocus(fallback) && (!remaining || remaining.contains(fallback)))
        fallback.focus({ preventScroll: true })
      else if (remaining) focusModalStart(remaining)
    }
  }
}

type ModalKeyboardEvent = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault' | 'stopPropagation'>

export function handleModalKeyDown(
  event: ModalKeyboardEvent,
  root: HTMLElement,
  close: () => void,
  closeDisabled: boolean
): void {
  // 让输入控件先处理自身事件，再阻止书架搜索或阅读快捷键收到弹窗中的按键。
  event.stopPropagation()
  if (event.key === 'Escape') {
    event.preventDefault()
    if (!closeDisabled) close()
    return
  }
  if (event.key !== 'Tab') return
  const controls = modalFocusableElements(root)
  const active = root.ownerDocument.activeElement
  const first = controls[0]
  const last = controls.at(-1)
  const outsideControls = !controls.includes(active as HTMLElement)
  if (!first || !last) {
    event.preventDefault()
    root.focus({ preventScroll: true })
  } else if (outsideControls || (event.shiftKey ? active === first : active === last)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus({ preventScroll: true })
  }
}

export function useModalFocus(onClose: () => void, closeDisabled = false, fallbackFocus?: () => HTMLElement | null) {
  const ref = useRef<HTMLDivElement>(null)
  const fallbackRef = useRef(fallbackFocus)
  fallbackRef.current = fallbackFocus
  useLayoutEffect(() => {
    if (ref.current) return activateModalFocus(ref.current, () => fallbackRef.current?.() ?? null)
  }, [])
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (ref.current) handleModalKeyDown(event, ref.current, onClose, closeDisabled)
  }
  return { ref, onKeyDown }
}
