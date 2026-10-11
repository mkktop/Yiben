import { describe, expect, it, vi } from 'vitest'
import { createDirectoryNavigation, createOrderedValue } from './orderedInteraction'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('连续书架与标签变更', () => {
  it('前一次写入未完成时选择第二个书架，两次归属均保留', async () => {
    const first = deferred<void>()
    const writes: number[][] = []
    const state = createOrderedValue<number[]>([])
    const save = vi.fn(async (next: number[]) => {
      writes.push(next)
      if (writes.length === 1) await first.promise
    })
    const a = state.update((ids) => [...ids, 1], save)
    const b = state.update((ids) => [...ids, 2], save)
    await Promise.resolve()
    expect(writes).toEqual([[1]])
    first.resolve()
    expect(await a).toEqual([1])
    expect(await b).toEqual([1, 2])
    expect(writes).toEqual([[1], [1, 2]])
  })

  it('连续移除两个标签不会将先删的标签重新加入', async () => {
    const state = createOrderedValue(['追更', '收藏', '完结'])
    const save = vi.fn(async (_tags: string[]) => {})
    const a = state.update((tags) => tags.filter((tag) => tag !== '追更'), save)
    const b = state.update((tags) => tags.filter((tag) => tag !== '收藏'), save)
    await a
    expect(await b).toEqual(['完结'])
    expect(save.mock.calls.map(([tags]) => tags)).toEqual([['收藏', '完结'], ['完结']])
  })

  it('失败后继续处理，后续写入不会携带失败的选择', async () => {
    const state = createOrderedValue<number[]>([1])
    const save = vi.fn(async (_next: number[]) => {})
    const failed = state.update((ids) => [...ids, 2], async () => {
      throw new Error('保存失败')
    })
    const next = state.update((ids) => [...ids, 3], save)
    await expect(failed).rejects.toThrow('保存失败')
    expect(await next).toEqual([1, 3])
    expect(save).toHaveBeenCalledWith([1, 3])
  })
})

describe('云盘目录导航', () => {
  it('返回上级失败时，路径、文件列表和挂载目标保持原目录', async () => {
    let displayed = { path: ['父目录', '子目录'], files: ['子目录漫画.cbz'] }
    const navigation = createDirectoryNavigation<string[], string[]>({
      commit: (path, files) => { displayed = { path, files } },
      error: vi.fn(),
      busy: vi.fn()
    })
    await navigation.navigate(['父目录'], async () => { throw new Error('网络中断') })
    expect(displayed).toEqual({ path: ['父目录', '子目录'], files: ['子目录漫画.cbz'] })
    expect(displayed.path.at(-1)).toBe('子目录')
  })

  it('切换云空间失败时，当前空间和挂载目录一起保留', async () => {
    let displayed = { family: '', path: ['我的漫画'] }
    const navigation = createDirectoryNavigation<typeof displayed, string[]>({
      commit: (target) => { displayed = target }, error: vi.fn(), busy: vi.fn()
    })
    await navigation.navigate({ family: '家庭云', path: [] }, async () => {
      throw new Error('家庭云不可用')
    })
    expect(displayed).toEqual({ family: '', path: ['我的漫画'] })
  })

  it('慢的旧响应不会覆盖新目录或提前解除加载状态', async () => {
    const first = deferred<string[]>()
    const second = deferred<string[]>()
    const commit = vi.fn()
    const busy = vi.fn()
    const navigation = createDirectoryNavigation<string, string[]>({ commit, error: vi.fn(), busy })
    const a = navigation.navigate('目录 A', () => first.promise)
    const b = navigation.navigate('目录 B', () => second.promise)
    first.resolve(['A.cbz'])
    await a
    expect(commit).not.toHaveBeenCalled()
    expect(busy).not.toHaveBeenCalledWith(false)
    second.resolve(['B.cbz'])
    await b
    expect(commit).toHaveBeenCalledExactlyOnceWith('目录 B', ['B.cbz'])
    expect(busy).toHaveBeenLastCalledWith(false)
  })
})
