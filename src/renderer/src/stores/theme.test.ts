import { beforeEach, describe, expect, it, vi } from 'vitest'

// theme store 在 node 环境下只需 document.documentElement 与 window.localStorage 两个宿主对象，
// 桩掉即可测 zustand persist 的迁移，不必引入 jsdom
// （zustand v5 的默认 storage 探测走 window.localStorage，window 缺失会静默禁用 persist）
function stubDom(seed?: string): { cls: Set<string>; dataset: Record<string, string> } {
  const cls = new Set<string>()
  const dataset: Record<string, string> = {}
  const storage = new Map<string, string>(seed ? [['yudu-theme', seed]] : [])
  const localStorageStub = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k)
  }
  vi.stubGlobal('document', {
    documentElement: {
      classList: { toggle: (c: string, on: boolean) => (on ? cls.add(c) : cls.delete(c), on) },
      dataset
    }
  })
  vi.stubGlobal('localStorage', localStorageStub)
  vi.stubGlobal('window', { localStorage: localStorageStub })
  return { cls, dataset }
}

describe('theme store', () => {
  // zustand persist 的 rehydrate 在微任务里完成，import 后先让一轮事件循环跑完
  const flush = () => new Promise((r) => setTimeout(r, 0))

  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('v0 旧二维主题（mode × preset）按 preset 归并为单主题', async () => {
    const cases = [
      { persisted: { mode: 'dark', preset: 'comic' }, expected: 'comic' },
      { persisted: { mode: 'light', preset: 'paper' }, expected: 'paper' },
      // 旧默认组合（纸墨深色）已下线，按 preset 归并到纸墨浅色
      { persisted: { mode: 'dark', preset: 'paper' }, expected: 'paper' }
    ]
    for (const { persisted, expected } of cases) {
      // 每个子 case 都要新模块实例 + 新桩，避免上一个 store 泄漏
      vi.unstubAllGlobals()
      vi.resetModules()
      stubDom(JSON.stringify({ state: persisted, version: 0 }))
      const { useThemeStore } = await import('./theme')
      await flush()
      expect(useThemeStore.getState().theme).toBe(expected)
    }
  })

  it('v1 直接读取 theme，不再受旧字段影响', async () => {
    stubDom(JSON.stringify({ state: { theme: 'comic' }, version: 1 }))
    const { useThemeStore } = await import('./theme')
    await flush()
    expect(useThemeStore.getState().theme).toBe('comic')
  })

  it.each(['unknown', null, 42, {}])('损坏的主题配置 %j 恢复为纸墨并可正常轮换', async (theme) => {
    const { cls, dataset } = stubDom(JSON.stringify({ state: { theme }, version: 1 }))
    const { useThemeStore } = await import('./theme')
    await flush()
    expect(useThemeStore.getState().theme).toBe('paper')
    expect(dataset.theme).toBe('paper')
    expect(cls.has('dark')).toBe(false)
    useThemeStore.getState().toggle()
    expect(useThemeStore.getState().theme).toBe('comic')
    expect(dataset.theme).toBe('comic')
  })

  it('保存霓虹主题后重新加载仍保持选择和深色样式', async () => {
    const { dataset, cls } = stubDom(JSON.stringify({ state: { theme: 'neon' }, version: 1 }))
    const { useThemeStore } = await import('./theme')
    await flush()
    expect(useThemeStore.getState().theme).toBe('neon')
    expect(dataset.theme).toBe('neon')
    expect(cls.has('dark')).toBe(true)
  })

  it('toggle 三态轮换 paper→comic→neon→paper（comic/neon 挂 .dark）', async () => {
    const { cls, dataset } = stubDom()
    const { useThemeStore } = await import('./theme')
    expect(useThemeStore.getState().theme).toBe('paper')

    useThemeStore.getState().toggle()
    expect(useThemeStore.getState().theme).toBe('comic')
    expect(cls.has('dark')).toBe(true)
    expect(dataset.theme).toBe('comic')

    useThemeStore.getState().toggle()
    expect(useThemeStore.getState().theme).toBe('neon')
    expect(cls.has('dark')).toBe(true)
    expect(dataset.theme).toBe('neon')

    useThemeStore.getState().toggle()
    expect(useThemeStore.getState().theme).toBe('paper')
    expect(cls.has('dark')).toBe(false)
    expect(dataset.theme).toBe('paper')
  })
})
