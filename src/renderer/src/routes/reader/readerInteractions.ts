/** 连续阅读只走局部页码；跨回路由话时单独返回全局目标，避免再次叠加拼接偏移。 */
export function resolveContinuousStep(
  page: number,
  pageCount: number,
  delta: number,
  embeddedStart: number | null = null
):
  | { kind: 'page'; page: number }
  | { kind: 'route-page'; page: number }
  | { kind: 'previous-chapter' | 'next-chapter' | 'blocked' } {
  const target = page + delta
  if (target < 0) {
    if (embeddedStart != null && embeddedStart > 0)
      return { kind: 'route-page', page: embeddedStart - 1 }
    return { kind: 'previous-chapter' }
  }
  if (pageCount > 0 && target >= pageCount)
    return { kind: embeddedStart != null ? 'blocked' : 'next-chapter' }
  return { kind: 'page', page: target }
}

/** 修饰键组合和控件的原生激活键交给系统 / 控件，阅读快捷键不能抢占它们。 */
export function acceptReaderShortcut(
  event: Pick<KeyboardEvent, 'key' | 'defaultPrevented' | 'isComposing' | 'ctrlKey' | 'altKey' | 'metaKey'>,
  target: 'reading' | 'editing' | 'control'
): boolean {
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey)
    return false
  if (target === 'editing') return false
  return !(target === 'control' && (event.key === 'Enter' || event.key === ' '))
}

export function readerShortcutTarget(target: EventTarget | null): 'reading' | 'editing' | 'control' {
  if (!(target instanceof Element)) return 'reading'
  if (target.closest('input,textarea,select,[contenteditable=true]')) return 'editing'
  if (target.closest('button,a,[role=button],[role=switch],[role=radio]')) return 'control'
  return 'reading'
}
