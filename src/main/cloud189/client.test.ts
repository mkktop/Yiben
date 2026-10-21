import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  getQRCode: vi.fn(),
  getUserSizeInfo: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => 'D:/yudu-client-test-userdata' },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('cloud189-sdk', () => {
  // 与 1.0.9 运行时形状一致：getQRCode 显式挑字段返回，没有 encodeuuid
  class Store {}
  class CloudClient {
    authClient = { getQRCode: mock.getQRCode }
    getUserSizeInfo = mock.getUserSizeInfo
  }
  return { CloudClient, Store, QRCodeStatus: { WAITING: 0, SCANNED: 1, SUCCESS: 2, EXPIRED: -1 } }
})
vi.mock('../settings', () => ({ getSetting: vi.fn(() => null), setSetting: vi.fn() }))
vi.mock('../events', () => ({ broadcast: vi.fn() }))

import { cloudQrStart } from './client'

const QR_UUID = 'https://open.e.189.cn/api/account/qrClinentLogin.do?paras=new_uuid%3Dabc%7C8025431004'

describe('天翼扫码登录二维码取图', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    mock.getQRCode.mockReset()
  })

  it('image.do 参数为 encodeURIComponent(uuid)，不依赖 SDK 未返回的 encodeuuid', async () => {
    mock.getQRCode.mockResolvedValue({
      uuid: QR_UUID,
      encryuuid: '6D95080AAFAF',
      reqId: 'req',
      lt: 'lt',
      paramId: 'param'
    })
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        urls.push(String(url))
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' }
        })
      })
    )
    const { dataUrl } = await cloudQrStart()
    // 回归点：旧实现取 qrData.encodeuuid（undefined）会拼出 uuid=undefined，
    // image.do 照样回 200 占位图，二维码可显示但扫码无效
    expect(urls).toEqual([
      `https://open.e.189.cn/api/logbox/oauth2/image.do?uuid=${encodeURIComponent(QR_UUID)}`
    ])
    expect(urls[0]).not.toContain('undefined')
    expect(dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true)
  })

  it('image.do 非 2xx 时抛出带状态码的错误', async () => {
    mock.getQRCode.mockResolvedValue({ uuid: QR_UUID })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 502 }))
    )
    await expect(cloudQrStart()).rejects.toThrow('HTTP 502')
  })
})
