import { describe, expect, it } from 'vitest'
import { matchSeries } from './relocate'
import type { RelocationSeries } from '../db'

function series(
  seriesId: number,
  folderPath: string,
  chapters: Array<[id: number, rel: string, size: number, mtime: number]>
): RelocationSeries {
  return {
    seriesId,
    folderPath,
    chapters: chapters.map(([id, rel, size, mtime]) => ({ id, rel, size, mtime }))
  }
}

describe('matchSeries 移动/改名指纹匹配', () => {
  it('强匹配：文件夹挪位置，章节相对路径与 (size, mtime) 全等', () => {
    const old = series(1, 'D:/books/海贼王', [
      [11, '第01话.zip', 100, 111],
      [12, '第02话.zip', 200, 222]
    ])
    const moved = series(2, 'E:/newroot/海贼王', [
      [21, '第01话.zip', 100, 111],
      [22, '第02话.zip', 200, 222]
    ])
    expect(matchSeries(old, moved)).toEqual(
      new Map([
        [11, 21],
        [12, 22]
      ])
    )
  })

  it('强匹配失败但内容指纹一致（≥2 章、排序后 size/mtime 序列相等）→ 弱匹配按顺序映射', () => {
    // 章节文件全部改名（rel 全变），但内容 size/mtime 不变
    const old = series(1, 'D:/books/one-piece', [
      [11, '001.zip', 100, 111],
      [12, '002.zip', 200, 222]
    ])
    const renamed = series(2, 'D:/books/海贼王', [
      [21, '第02话.zip', 200, 222],
      [22, '第01话.zip', 100, 111]
    ])
    // 排序键 rel：old=[001,002] → renamed=[第01话,第02话]，(size,mtime) 序列对齐
    expect(matchSeries(old, renamed)).toEqual(
      new Map([
        [11, 22],
        [12, 21]
      ])
    )
  })

  it('单章改名不弱匹配（无法与复制区分，宁可漏掉）', () => {
    const old = series(1, 'D:/books/a.epub', [[11, 'a.epub', 100, 111]])
    const renamed = series(2, 'D:/books/b.epub', [[21, 'b.epub', 100, 111]])
    expect(matchSeries(old, renamed)).toBeNull()
  })

  it('单章移动（rel 不变）仍可强匹配', () => {
    const old = series(1, 'D:/books/a.epub', [[11, 'a.epub', 100, 111]])
    const moved = series(2, 'E:/x/a.epub', [[21, 'a.epub', 100, 111]])
    expect(matchSeries(old, moved)).toEqual(new Map([[11, 21]]))
  })

  it('章节数不同 / 内容指纹不同 → 不匹配', () => {
    const a = series(1, 'p1', [
      [11, 'x.zip', 100, 111],
      [12, 'y.zip', 200, 222]
    ])
    const fewer = series(2, 'p2', [[21, 'x.zip', 100, 111]])
    expect(matchSeries(a, fewer)).toBeNull()

    const grown = series(3, 'p3', [
      [31, 'x.zip', 100, 111],
      [32, 'y.zip', 999, 222]
    ])
    expect(matchSeries(a, grown)).toBeNull()
  })
})
