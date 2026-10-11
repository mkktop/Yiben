import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ userData: '' }))

// db/index.ts 只用到 app.getPath('userData')
vi.mock('electron', () => ({ app: { getPath: () => mocks.userData } }))

import {
  addLibrary,
  closeDb,
  createShelf,
  listSeries,
  listShelves,
  listTags,
  openDb,
  removeLibrary,
  removeShelf,
  setSeriesShelves,
  setSeriesTags,
  seriesShelfIds,
  seriesTagNames,
  upsertSeries
} from './index'

let dir = ''

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'yudu-shelves-'))
  mocks.userData = dir
  openDb()
  addLibrary('书架测试库', 'D:/shelves')
})

afterAll(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

function seedSeries(title: string): number {
  return upsertSeries({
    library_id: 1,
    title,
    author: null,
    description: null,
    status: null,
    tags: null,
    folder_path: `D:/shelves/${title}`,
    is_single_file: 0
  })
}

describe('虚拟书架', () => {
  it('创建幂等：同名 createShelf 返回同一行，不产生重复', () => {
    const a = createShelf('追更中')
    const b = createShelf('追更中')
    expect(b.id).toBe(a.id)
    expect(listShelves().filter((s) => s.name === '追更中')).toHaveLength(1)
  })

  it('setSeriesShelves 全量替换语义：以传入清单为准，空数组清空归属', () => {
    const s1 = createShelf('甲')
    const s2 = createShelf('乙')
    const s3 = createShelf('丙')
    const seriesId = seedSeries('替换系列')

    setSeriesShelves(seriesId, [s1.id, s2.id])
    expect(seriesShelfIds(seriesId).sort()).toEqual([s1.id, s2.id].sort())

    // 再传入包含旧值 + 新值的清单：结果与库内状态无关，全量对齐
    setSeriesShelves(seriesId, [s2.id, s3.id, s3.id]) // 重复 id 去重
    expect(seriesShelfIds(seriesId).sort()).toEqual([s2.id, s3.id].sort())

    // 空数组 = 移出所有书架
    setSeriesShelves(seriesId, [])
    expect(seriesShelfIds(seriesId)).toEqual([])
  })

  it('级联删除：删除书架清关联行；删除书库连带系列的归属与标签', () => {
    const shelf = createShelf('待删除')
    const keep = createShelf('保留')
    const seriesId = seedSeries('级联系列')
    setSeriesShelves(seriesId, [shelf.id, keep.id])
    setSeriesTags(seriesId, ['冒险'])

    // 删书架：series_shelves 里它的行消失，其它书架的关联保留
    removeShelf(shelf.id)
    expect(listShelves().some((s) => s.id === shelf.id)).toBe(false)
    expect(seriesShelfIds(seriesId)).toEqual([keep.id])
    expect(
      openDb().prepare('SELECT COUNT(*) AS c FROM series_shelves WHERE shelf_id = ?').get(shelf.id)
    ).toEqual({ c: 0 })

    // 删书库：系列被级联删除，series_shelves / series_tags 关联行不留孤儿
    const lib2 = addLibrary('第二个库', 'D:/shelves-2')
    const orphan = upsertSeries({
      library_id: lib2.id,
      title: '孤儿系列',
      author: null,
      description: null,
      status: null,
      tags: null,
      folder_path: 'D:/shelves-2/孤儿系列',
      is_single_file: 0
    })
    setSeriesShelves(orphan, [keep.id])
    setSeriesTags(orphan, ['奇幻'])
    removeLibrary(lib2.id)

    expect(
      openDb().prepare('SELECT COUNT(*) AS c FROM series_shelves WHERE series_id = ?').get(orphan)
    ).toEqual({ c: 0 })
    expect(
      openDb().prepare('SELECT COUNT(*) AS c FROM series_tags WHERE series_id = ?').get(orphan)
    ).toEqual({ c: 0 })
    // 删除后无人引用的标签行也被清掉，「冒险」仍被 级联系列 引用着要保留
    expect(listTags().some((t) => t.name === '奇幻')).toBe(false)
    expect(listTags().some((t) => t.name === '冒险')).toBe(true)
  })
})

describe('自定义标签与筛选', () => {
  it('setSeriesTags：不存在的标签自动创建，全量替换 + 孤儿清理', () => {
    const a = seedSeries('标签A')
    const b = seedSeries('标签B')

    setSeriesTags(a, ['热血', ' 冒险 ', '热血']) // 空白裁剪 + 去重
    expect(seriesTagNames(a).sort()).toEqual(['冒险', '热血'].sort())

    setSeriesTags(b, ['热血'])
    // 替换：A 换成新清单后，无人引用的「独占标签」被清理；
    // 「冒险」仍被前面用例的「级联系列」引用着，必须保留
    setSeriesTags(a, ['热血', '独占标签'])
    expect(seriesTagNames(a).sort()).toEqual(['热血', '独占标签'].sort())
    setSeriesTags(a, ['搞笑', '热血'])
    expect(seriesTagNames(a).sort()).toEqual(['搞笑', '热血'].sort())
    expect(listTags().map((t) => t.name).sort()).toEqual(['热血', '搞笑', '冒险'].sort())

    // listSeries 的标签筛选：单标签命中所有带该标签的系列；多标签 AND 语义
    expect(listSeries({ tags: ['热血'] }).map((s) => s.title).sort()).toEqual(
      ['标签A', '标签B'].sort()
    )
    expect(listSeries({ tags: ['热血', '搞笑'] }).map((s) => s.title)).toEqual(['标签A'])

    // 书架筛选同样作用于 listSeries
    const shelf = createShelf('筛选书架')
    setSeriesShelves(a, [shelf.id])
    expect(listSeries({ shelfId: shelf.id }).map((s) => s.title)).toEqual(['标签A'])
  })
})
