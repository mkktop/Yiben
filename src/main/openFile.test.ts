import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
const mock = vi.hoisted(() => ({ scan: vi.fn(), broadcast: vi.fn(), getChapter: vi.fn() }))
vi.mock('./db', () => ({
  addLibrary: () => ({ id: 8 }),
  getChapterByPath: mock.getChapter,
  rebuildFts: vi.fn()
}))
vi.mock('./scanner', () => ({ scanOneLocalSeries: mock.scan }))
vi.mock('./rescan', () => ({ runExclusiveScan: (fn: () => Promise<unknown>) => fn() }))
vi.mock('./events', () => ({ broadcast: mock.broadcast }))
const dir = mkdtempSync(join(tmpdir(), 'yudu-association-')),
  file = join(dir, '文件.CBZ')
writeFileSync(file, '测试路径')
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mock.scan.mockResolvedValue(undefined)
  mock.getChapter.mockReturnValue({ id: 42 })
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))
describe('冷启动与热启动文件关联', () => {
  it('冷启动存到领取槽并补发，就绪广播早于订阅也不丢文件', async () => {
    const module = await import('./openFile')
    module.handleArgv(['electron.exe', '.', file])
    await vi.waitFor(() => expect(mock.scan).toHaveBeenCalled())
    await vi.waitFor(() => expect(mock.getChapter).toHaveBeenCalled())
    module.markWindowReady()
    expect(mock.broadcast).toHaveBeenCalledWith('app:openFile', { chapterId: 42 })
    expect(module.takePendingOpenFile()).toBe(42)
    expect(module.takePendingOpenFile()).toBeNull()
    expect(mock.scan).toHaveBeenCalledWith(8, { folder: resolve(file), isSingleFile: true })
  })
  it('热启动直接广播，格式不支持或文件不存在不扫描', async () => {
    const module = await import('./openFile')
    module.markWindowReady()
    module.handleFilePath(file)
    await vi.waitFor(() =>
      expect(mock.broadcast).toHaveBeenCalledWith('app:openFile', { chapterId: 42 })
    )
    expect(module.takePendingOpenFile()).toBeNull()
    module.handleFilePath(join(dir, '不存在.cbz'))
    module.handleArgv(['配置.json'])
    expect(mock.scan).toHaveBeenCalledTimes(1)
  })
})
