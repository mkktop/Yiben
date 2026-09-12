import { describe, expect, it } from 'vitest'
import { groupDuplicateSeries, normalizeTitle } from './diagnose'

describe('normalizeTitle 标题归一化', () => {
  it('全角转半角：全角字母/数字/标点/空格与半角形态归一', () => {
    expect(normalizeTitle('ＯＮＥ　ＰＩＥＣＥ！')).toBe(normalizeTitle('ONE PIECE!'))
    expect(normalizeTitle('Ｆａｔｅ／Ｓｔａｙ　ｎｉｇｈｔ')).toBe(normalizeTitle('fate/stay night'))
  })

  it('卷次后缀：第N卷 / Vol.N / vol N / (N) 剥掉后与本体一致', () => {
    const base = normalizeTitle('海贼王')
    expect(normalizeTitle('海贼王 第12卷')).toBe(base)
    expect(normalizeTitle('海贼王 Vol.3')).toBe(base)
    expect(normalizeTitle('海贼王 vol 3')).toBe(base)
    expect(normalizeTitle('海贼王(12)')).toBe(base)
    expect(normalizeTitle('海贼王 第04话')).toBe(base)
  })

  it('大小写不敏感', () => {
    expect(normalizeTitle('One Piece')).toBe(normalizeTitle('ONE PIECE'))
    expect(normalizeTitle('bleach')).toBe(normalizeTitle('Bleach'))
  })

  it('标点与空白不参与比较，中日韩文字保留', () => {
    expect(normalizeTitle('Re:从零开始的异世界生活')).toBe(
      normalizeTitle('Re 从零开始的异世界生活')
    )
    expect(normalizeTitle('鬼滅の刃！～全一巻～')).toContain('鬼滅の刃')
  })

  it('不同的书不会因共享前缀或收录差异而误报；只剩卷号归一化为空', () => {
    expect(normalizeTitle('进击的巨人')).not.toBe(normalizeTitle('进击的巨人 before the fall'))
    expect(normalizeTitle('火影忍者 第1卷')).not.toBe(normalizeTitle('火影忍者 疾风传'))
    expect(normalizeTitle('海贼王 第1卷')).not.toBe(normalizeTitle('海贼王 第12卷') + 'x')
    // 整个标题就是卷号：归一化结果为空，分组时应跳过
    expect(normalizeTitle('第3卷')).toBe('')
  })
})

describe('groupDuplicateSeries 重复分组', () => {
  it('归一化标题相同的系列归入同组，组内数量 ≤1 的不返回', () => {
    const rows = [
      { id: 1, title: '海贼王', folder_path: 'D:/comics/one-piece' },
      { id: 2, title: '海贼王 第2卷', folder_path: 'D:/comics/one-piece-vol2' },
      { id: 3, title: '海贼王 vol.1', folder_path: 'D:/comics/one-piece-vol1' },
      { id: 4, title: '火影忍者', folder_path: 'D:/comics/naruto' },
      { id: 5, title: '第3卷', folder_path: 'D:/comics/卷号残片' }
    ]
    const groups = groupDuplicateSeries(rows)
    expect(groups).toHaveLength(1)
    expect(groups[0].map((i) => i.id).sort()).toEqual([1, 2, 3])
    expect(groups[0][0].folderPath).toBe('D:/comics/one-piece')
  })

  it('空输入返回空数组', () => {
    expect(groupDuplicateSeries([])).toEqual([])
  })
})
