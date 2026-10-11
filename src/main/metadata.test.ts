import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { path7za } from '7zip-bin'
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => mock.dir } }))
vi.mock('./backup', () => ({ createBackup: vi.fn(async () => ({})) }))
vi.mock('./rescan', () => ({ runExclusiveScan: (fn: () => Promise<unknown>) => fn() }))
import {
  openDb,
  closeDb,
  addLibrary,
  upsertSeries,
  upsertChapter,
  getSeries,
  updateSeriesMeta
} from './db'
import { searchMetadata, applyMetadata, writeComicInfo, buildComicInfo } from './metadata'
import { withDriver } from './archives'
import { parseComicInfoXml } from './scanner/comicinfo'
let id = 0,
  zip = ''
beforeAll(() => {
  mock.dir = mkdtempSync(join(tmpdir(), 'yudu-meta-'))
  openDb()
  const folder = join(mock.dir, '书库')
  mkdirSync(folder)
  const lib = addLibrary('回写库', folder)
  id = upsertSeries({
    library_id: lib.id,
    title: '原书名',
    author: 'A & B',
    description: '<简介>',
    status: null,
    tags: '["热血"]',
    folder_path: folder,
    is_single_file: 0
  })
  writeFileSync(join(folder, '1.png'), Buffer.from([1, 3, 5, 7]))
  zip = join(folder, '第1话.zip')
  execFileSync(path7za, ['a', '-tzip', zip, join(folder, '1.png')], {
    stdio: 'ignore',
    windowsHide: true
  })
  upsertChapter({
    series_id: id,
    title: '第1话',
    volume: null,
    number: 1,
    sort_index: 0,
    path: zip,
    kind: 'zip',
    page_count: 1,
    size: readFileSync(zip).length,
    mtime: 0
  })
})
afterEach(() => vi.unstubAllGlobals())
afterAll(() => {
  closeDb()
  rmSync(mock.dir, { recursive: true, force: true })
})
describe('元数据确认与回写', () => {
  it('XML 正确转义特殊字符，能够回读', () => {
    const xml = buildComicInfo(getSeries(id)!)
    expect(parseComicInfoXml(xml)?.author).toBe('A & B')
    expect(parseComicInfoXml(xml)?.description).toBe('<简介>')
    expect(xml).toContain('&amp;')
  })
  it('搜索只返回候选，明确应用后才修改数据库；失效候选拒绝', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _options?: RequestInit) =>
        new Response(
          JSON.stringify({
            data: {
              Page: {
                media: [
                  {
                    id: 7,
                    title: { native: '新书名' },
                    description: '<b>新简介</b>',
                    status: 'FINISHED',
                    genres: ['Adventure'],
                    staff: { edges: [{ role: 'Story & Art', node: { name: { native: '作者' } } }] }
                  }
                ]
              }
            }
          })
        )
    )
    vi.stubGlobal('fetch', fetchMock)
    const results = await searchMetadata('新书名')
    expect(getSeries(id)?.title).toBe('原书名')
    expect(results[0].description).toBe('新简介')
    applyMetadata(id, results[0].id)
    expect(getSeries(id)?.title).toBe('新书名')
    expect(getSeries(id)?.author).toBe('作者')
    expect(() => applyMetadata(id, 'anilist:expired')).toThrow('失效')
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).variables.search).toBe('新书名')
  })
  it('限流清楚报错且不覆盖信息', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 429 }))
    )
    await expect(searchMetadata('新书名')).rejects.toThrow('过于频繁')
    expect(getSeries(id)?.title).toBe('新书名')
  })
  it('ZIP 在副本更新，原页字节与备份保持；扫描元数据不覆盖手动修改', async () => {
    const before = readFileSync(zip)
    const original = await withDriver(zip, false, (driver) => driver.readPage(0))
    const files = await writeComicInfo(id)
    expect(files).toContain(zip)
    const xml = await withDriver(zip, false, async (driver) => {
      expect(await driver.readPage(0)).toEqual(original)
      return await driver.readEntry?.('ComicInfo.xml')
    })
    expect(parseComicInfoXml(xml!.toString())?.series).toBe('新书名')
    const { readdirSync } = await import('fs')
    const backup = readdirSync(join(mock.dir, '书库')).find((name) =>
      name.startsWith('第1话.zip.before-yudu-')
    )!
    expect(readFileSync(join(mock.dir, '书库', backup))).toEqual(before)
    updateSeriesMeta(id, { title: '手动书名' })
    upsertSeries({ ...getSeries(id)!, title: '扫描标题' })
    expect(getSeries(id)?.title).toBe('手动书名')
  })
})
