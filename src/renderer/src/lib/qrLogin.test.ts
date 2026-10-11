import { describe, expect, it, vi } from 'vitest'
import { createQrLogin, type QrApi } from './qrLogin'

function callbacks() {
  return { image: vi.fn(), state: vi.fn(), error: vi.fn(), loading: vi.fn(), done: vi.fn(async () => {}) }
}

describe('二维码登录重试', () => {
  it('首次取码失败结束加载，重试成功清除错误后才能轮询', async () => {
    const api = {
      start: vi.fn().mockRejectedValueOnce(new Error('连接失败')).mockResolvedValueOnce({ dataUrl: '新二维码' }),
      poll: vi.fn(async () => ({ state: 'waiting' as const }))
    }
    const ui = callbacks()
    const login = createQrLogin(api, ui)
    await login.refresh()
    expect(ui.loading).toHaveBeenLastCalledWith(false)
    expect(ui.error).toHaveBeenLastCalledWith('获取二维码失败，请检查网络后重新获取。')
    await login.poll()
    expect(api.poll).not.toHaveBeenCalled()
    await login.refresh()
    expect(ui.image).toHaveBeenLastCalledWith('新二维码')
    expect(ui.error).toHaveBeenLastCalledWith('')
    await login.poll()
    expect(api.poll).toHaveBeenCalledOnce()
  })

  it('连续失败有反馈，保留已扫描状态，恢复成功后清除错误', async () => {
    const api: QrApi = { start: async () => ({ dataUrl: '二维码' }), poll: vi.fn() }
    const poll = vi.mocked(api.poll)
    const ui = callbacks()
    const login = createQrLogin(api, ui)
    await login.refresh()
    poll.mockResolvedValueOnce({ state: 'scanned' })
    await login.poll()
    poll.mockRejectedValue(new Error('网络中断'))
    await login.poll()
    await login.poll()
    expect(ui.error).toHaveBeenLastCalledWith('')
    await login.poll()
    expect(ui.error).toHaveBeenLastCalledWith(expect.stringContaining('正在自动重试'))
    expect(ui.state).toHaveBeenLastCalledWith('scanned')
    poll.mockResolvedValueOnce({ state: 'scanned' })
    await login.poll()
    expect(ui.error).toHaveBeenLastCalledWith('')
    expect(ui.state).toHaveBeenLastCalledWith('scanned')
    await login.poll()
    expect(ui.error).toHaveBeenLastCalledWith('')
  })

  it('刷新后的旧轮询结果不会将新二维码设为过期', async () => {
    let settle!: (value: { state: 'expired' }) => void
    const api: QrApi = {
      start: vi.fn(async () => ({ dataUrl: '新二维码' })),
      poll: () => new Promise((resolve) => { settle = resolve })
    }
    const ui = callbacks()
    const login = createQrLogin(api, ui)
    await login.refresh()
    const pending = login.poll()
    await login.refresh()
    settle({ state: 'expired' })
    await pending
    expect(ui.state).toHaveBeenLastCalledWith('waiting')
    expect(ui.image).toHaveBeenLastCalledWith('新二维码')
  })

  it('关闭后的取码响应不会更新隐藏面板', async () => {
    let settle!: (value: { dataUrl: string }) => void
    const api: QrApi = {
      start: () => new Promise((resolve) => { settle = resolve }),
      poll: async () => ({ state: 'waiting' })
    }
    const ui = callbacks()
    const login = createQrLogin(api, ui)
    const pending = login.refresh()
    login.close()
    settle({ dataUrl: '过时二维码' })
    await pending
    expect(ui.image).not.toHaveBeenCalledWith('过时二维码')
  })
})
