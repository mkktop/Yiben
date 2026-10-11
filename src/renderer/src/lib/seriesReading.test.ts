import { describe, expect, it } from 'vitest'
import { seriesReading } from './seriesReading'

const unread = (id: number) => ({ id, read_page: null, completed: null, read_updated_at: null })
const progress = (id: number, time: number, page = 1, completed = 0) =>
  ({ id, read_page: page, completed, read_updated_at: time })

describe('系列阅读入口', () => {
  it('未开始的系列打开第一话', () => {
    const chapters = [unread(1), unread(2)]
    expect(seriesReading(chapters)).toEqual({ chapter: chapters[0], started: false })
  })

  it('跳话阅读后继续最近的未完话，而不是倒回第一话', () => {
    const chapters = [unread(1), progress(2, 100), progress(3, 200)]
    expect(seriesReading(chapters)).toEqual({ chapter: chapters[2], started: true })
    expect(chapters.map((chapter) => chapter.id)).toEqual([1, 2, 3])
  })

  it('首屏也属于有效进度；时间并列时与首页一样取较大章节 ID', () => {
    const chapters = [progress(3, 100, 0), progress(2, 100)]
    expect(seriesReading(chapters)).toEqual({ chapter: chapters[0], started: true })
  })

  it('完成一话后进入按顺序的下一未读话', () => {
    const chapters = [progress(1, 300, 9, 1), unread(2)]
    expect(seriesReading(chapters)).toEqual({ chapter: chapters[1], started: true })
  })

  it('全部读完时仍可打开最后一话', () => {
    const chapters = [progress(1, 200, 9, 1), progress(2, 100, 9, 1)]
    expect(seriesReading(chapters)).toEqual({ chapter: chapters[1], started: true })
  })

  it('无章节时不产生阅读入口', () => {
    expect(seriesReading([])).toEqual({ chapter: null, started: false })
  })
})
