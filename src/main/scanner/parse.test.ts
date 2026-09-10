import { describe, expect, it } from 'vitest'
import { parseChapterName } from './parse'

describe('parseChapterName', () => {
  it('解析「第 X 卷」', () => {
    const r = parseChapterName('海贼王 第01卷')
    expect(r.volume).toBe(1)
    expect(r.number).toBeUndefined()
    expect(r.title).toBe('海贼王')
  })

  it('解析「第 X 话」', () => {
    const r = parseChapterName('进击的巨人 第05话 超大型巨人')
    expect(r.number).toBe(5)
    expect(r.volume).toBeUndefined()
    expect(r.title).toBe('进击的巨人 超大型巨人')
  })

  it('解析英文卷号 v02', () => {
    const r = parseChapterName('One Piece v02')
    expect(r.volume).toBe(2)
    expect(r.title).toBe('One Piece')
  })

  it('解析 [Group] Title c005', () => {
    const r = parseChapterName('[汉化组] 某漫画 c005')
    expect(r.number).toBe(5)
    expect(r.title).toBe('某漫画')
  })

  it('解析 Chapter 12 - Special', () => {
    const r = parseChapterName('Chapter 12 - Special')
    expect(r.number).toBe(12)
    expect(r.title).toBe('Special')
  })

  it('解析结尾数字', () => {
    const r = parseChapterName('某个长篇 013')
    expect(r.number).toBe(13)
    expect(r.title).toBe('某个长篇')
  })

  it('无数字时保留原名', () => {
    const r = parseChapterName('特别短篇 完结')
    expect(r.title).toBe('特别短篇 完结')
    expect(r.volume).toBeUndefined()
    expect(r.number).toBeUndefined()
  })

  it('解析小数话数', () => {
    const r = parseChapterName('第12.5话 番外')
    expect(r.number).toBe(12.5)
  })
})
