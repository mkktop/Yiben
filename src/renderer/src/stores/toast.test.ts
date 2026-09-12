import { beforeEach, describe, expect, it } from 'vitest'
import { useToastStore } from './toast'

const ids = (): string[] => useToastStore.getState().toasts.map((t) => t.id)

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
})

describe('全局 Toast 队列（扫描提示 / 云通知堆叠）', () => {
  it('不同来源并存，互不顶替', () => {
    const { push } = useToastStore.getState()
    push({ id: 'scan-notice', kind: 'warning', title: '扫描提示' })
    push({ id: 'cloud-notice', kind: 'error', title: '云端会话失效' })
    expect(ids()).toEqual(['scan-notice', 'cloud-notice'])
  })

  it('同槽位重推只保留最新一条（换内容不叠罗汉）', () => {
    const { push } = useToastStore.getState()
    push({ id: 'cloud-notice', kind: 'warning', title: '触发限流' })
    push({ id: 'cloud-notice', kind: 'error', title: '云端会话失效' })
    expect(useToastStore.getState().toasts).toHaveLength(1)
    expect(ids()).toEqual(['cloud-notice'])
    expect(useToastStore.getState().toasts[0].title).toBe('云端会话失效')
  })

  it('close 只移除自己的槽位，不影响其他来源', () => {
    const { push, close } = useToastStore.getState()
    push({ id: 'scan-notice', kind: 'warning', title: '扫描提示' })
    push({ id: 'cloud-notice', kind: 'error', title: '云端会话失效' })
    close('scan-notice')
    expect(ids()).toEqual(['cloud-notice'])
  })
})
