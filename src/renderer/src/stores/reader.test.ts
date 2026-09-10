import { beforeEach, describe, expect, it } from 'vitest'
import { atLastScreen, resumeStartPage, spreadPages, useReaderStore } from './reader'

/** 把 store 初始化成指定页数/起始页（prefs 用默认值） */
function setup(pageCount: number, startPage = 0): void {
  useReaderStore.getState().init({}, pageCount, startPage)
}

describe('spreadPages', () => {
  it('封面单独展示，之后按 (1,2) (3,4) 成对', () => {
    expect(spreadPages(0, 10, false)).toEqual([0])
    expect(spreadPages(1, 10, false)).toEqual([1, 2])
    expect(spreadPages(2, 10, false)).toEqual([1, 2])
    expect(spreadPages(3, 10, false)).toEqual([3, 4])
  })

  it('日漫方向只反转 spread 内的左右顺序', () => {
    expect(spreadPages(1, 10, true)).toEqual([2, 1])
    expect(spreadPages(2, 10, true)).toEqual([2, 1])
  })

  it('末页落单', () => {
    expect(spreadPages(9, 10, false)).toEqual([9])
  })

  it('页数未知时退化为单页', () => {
    expect(spreadPages(0, 0, true)).toEqual([0])
    expect(spreadPages(3, 0, true)).toEqual([3])
  })

  it('跨页大图单独占一屏，其后重新配对', () => {
    const wide = [2]
    // 第 2 页是横跨页：它自己一屏，第 1 页也跟着落单
    expect(spreadPages(1, 10, false, wide)).toEqual([1])
    expect(spreadPages(2, 10, false, wide)).toEqual([2])
    // 跨页之后的配对从下一页重新开始
    expect(spreadPages(3, 10, false, wide)).toEqual([3, 4])
    expect(spreadPages(4, 10, false, wide)).toEqual([3, 4])
    // 不受影响的普通屏照常成对
    expect(spreadPages(5, 10, false, wide)).toEqual([5, 6])
  })

  it('rtl 只反转展示顺序，不影响配对', () => {
    expect(spreadPages(3, 10, true, [2])).toEqual([4, 3])
  })
})

describe('翻页步进', () => {
  beforeEach(() => setup(10))

  it('单页模式逐页递增', () => {
    const s = useReaderStore.getState()
    s.next()
    expect(useReaderStore.getState().page).toBe(1)
    useReaderStore.getState().prev()
    expect(useReaderStore.getState().page).toBe(0)
  })

  // 回归：曾经在 double + rtl（默认方向）下 next 会反向，导致连按右方向键卡在封面。
  // 页码语义 = 当前 spread 的起始页：封面 [0] → (1,2) → (3,4) …
  it('双页 + 日漫方向仍然能推进，封面后进入 (1,2) 屏', () => {
    useReaderStore.getState().patch({ mode: 'double' })
    const visited: number[] = [useReaderStore.getState().page]
    for (let i = 0; i < 5; i++) {
      useReaderStore.getState().next()
      visited.push(useReaderStore.getState().page)
    }
    expect(visited).toEqual([0, 1, 3, 5, 7, 9])
  })

  it('双页 + 从左往右 与 日漫方向步进一致', () => {
    useReaderStore.getState().patch({ mode: 'double', rtl: false })
    useReaderStore.getState().next()
    expect(useReaderStore.getState().page).toBe(1)
    useReaderStore.getState().prev()
    expect(useReaderStore.getState().page).toBe(0)
  })

  it('跨页大图处步长自动变 1，且每屏恰好访问一次', () => {
    useReaderStore.getState().patch({ mode: 'double' })
    useReaderStore.getState().setWidePages([5])
    const visited: number[] = [useReaderStore.getState().page]
    for (let i = 0; i < 9; i++) {
      useReaderStore.getState().next()
      visited.push(useReaderStore.getState().page)
    }
    // (1,2)(3,4) [5 单独] (6,7)(8,9)
    expect(visited).toEqual([0, 1, 3, 5, 6, 8, 9, 9, 9, 9])
    // 每一屏都覆盖到
    const spreads = new Set(
      visited.map((p) =>
        JSON.stringify(spreadPages(p, 10, false, useReaderStore.getState().widePages))
      )
    )
    expect(spreads.size).toBe(6)
  })

  it('不会越过首页', () => {
    useReaderStore.getState().prev()
    expect(useReaderStore.getState().page).toBe(0)
  })

  it('不会越过末页', () => {
    useReaderStore.getState().setPage(99)
    expect(useReaderStore.getState().page).toBe(9)
  })
})

describe('页数未知（页面回填前）', () => {
  // 回归：pageCount=0 时 setPage 曾算出 -1，协议层直接报「页码越界」
  it('不会产生负数页码', () => {
    setup(0)
    useReaderStore.getState().prev()
    expect(useReaderStore.getState().page).toBe(0)
  })

  it('未知页数时不做上界钳位，仍可向后翻', () => {
    setup(0)
    useReaderStore.getState().next()
    expect(useReaderStore.getState().page).toBe(1)
  })

  it('初始化时保留恢复位置而不是压回 0', () => {
    setup(0, 12)
    expect(useReaderStore.getState().page).toBe(12)
  })

  it('页数回填后重新钳位', () => {
    setup(0, 12)
    const s = useReaderStore.getState()
    useReaderStore.setState({ pageCount: 5 })
    s.setPage(useReaderStore.getState().page)
    expect(useReaderStore.getState().page).toBe(4)
  })
})

describe('atLastScreen（读完进下一话的边界）', () => {
  it('单页/条漫按 page 判定', () => {
    expect(atLastScreen(8, 9, 'single')).toBe(true)
    expect(atLastScreen(7, 9, 'single')).toBe(false)
    expect(atLastScreen(8, 9, 'webtoon')).toBe(true)
  })

  // 回归：双页模式 7 页的最后一屏是 (5,6)，旧判定 page>=6 会先单独重复展示第 7 页
  it('双页模式最后一屏是两页时也算读完', () => {
    expect(atLastScreen(5, 7, 'double')).toBe(true)
    expect(atLastScreen(6, 7, 'double')).toBe(true)
    expect(atLastScreen(3, 7, 'double')).toBe(false)
  })

  it('跨页大图单独成屏不影响末屏判定', () => {
    expect(atLastScreen(8, 9, 'double', [8])).toBe(true)
    expect(atLastScreen(9, 10, 'double', [8])).toBe(true)
    expect(atLastScreen(7, 10, 'double', [8])).toBe(false)
  })

  it('页数未知（云端压缩包未回填）时不判定读完', () => {
    expect(atLastScreen(0, 0, 'single')).toBe(false)
    expect(atLastScreen(99, 0, 'double')).toBe(false)
  })
})

describe('resumeStartPage（打开章节的起始页）', () => {
  it('没有进度从第 1 页开始', () => {
    expect(resumeStartPage(null, 20)).toBe(0)
  })

  it('未读完回到上次位置', () => {
    expect(resumeStartPage({ page: 7, completed: 0 }, 20)).toBe(7)
    // 页数未知（云端压缩包）时只要没标完成就照常恢复
    expect(resumeStartPage({ page: 12, completed: 0 }, 0)).toBe(12)
  })

  // 回归：点「下一话」跳进读过的章节曾落在末页，随手翻页又触发进下一话
  it('已读完（或进度停在末页）从头开始', () => {
    expect(resumeStartPage({ page: 19, completed: 1 }, 20)).toBe(0)
    expect(resumeStartPage({ page: 19, completed: 0 }, 20)).toBe(0)
  })
})
