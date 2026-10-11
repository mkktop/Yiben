import { describe, expect, it, vi } from 'vitest'
import { createConfirmation } from './confirmation'

describe('确认操作执行', () => {
  it('连续确认与处理中关闭均不会造成重复操作或提前关闭', async () => {
    let finish!: () => void
    const action = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const close = vi.fn()
    const busy = vi.fn()
    const confirmation = createConfirmation({ busy, error: vi.fn() })
    const first = confirmation.confirm(action, close)
    await confirmation.confirm(action, close)
    confirmation.dismiss(close)
    expect(action).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
    expect(busy).toHaveBeenLastCalledWith(true)
    finish()
    await first
    expect(close).toHaveBeenCalledOnce()
    expect(busy).toHaveBeenLastCalledWith(false)
    await confirmation.confirm(action, close)
    expect(action).toHaveBeenCalledOnce()
  })

  it('失败保留确认框，清理错误后可重试成功', async () => {
    const error = vi.fn()
    const close = vi.fn()
    const busy = vi.fn()
    const confirmation = createConfirmation({ busy, error })
    const action = vi.fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("Error invoking remote method 'backup:restore': Error: 备份文件不可用"))
      .mockResolvedValueOnce(undefined)
    await confirmation.confirm(action, close)
    expect(error).toHaveBeenLastCalledWith('备份文件不可用')
    expect(close).not.toHaveBeenCalled()
    expect(busy).toHaveBeenLastCalledWith(false)
    await confirmation.confirm(action, close)
    expect(action).toHaveBeenCalledTimes(2)
    expect(error).toHaveBeenLastCalledWith('')
    expect(close).toHaveBeenCalledOnce()
  })

  it('取消不执行操作；同步抛错也会释放操作锁', async () => {
    const error = vi.fn()
    const close = vi.fn()
    const confirmation = createConfirmation({ busy: vi.fn(), error })
    confirmation.dismiss(close)
    expect(close).toHaveBeenCalledOnce()
    close.mockClear()
    await confirmation.confirm(() => { throw new Error('无法开始操作') }, close)
    expect(error).toHaveBeenLastCalledWith('无法开始操作')
    expect(close).not.toHaveBeenCalled()
    confirmation.dismiss(close)
    expect(close).toHaveBeenCalledOnce()
  })
})
