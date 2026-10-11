import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { normalizeTheme, nextTheme, type ThemeName } from '@/lib/themes'

/**
 * 主题即成品：风格与明暗绑定，不再二维组合。
 * paper = 纸墨书斋（暖纸 + 朱砂 · 浅色），comic = 现代漫画（墨蓝黑 + 信号黄 · 深色），
 * neon = 霓虹夜读（暗夜 + 粉紫青环彩 · 深色，与品牌方标同源）
 */
export type { ThemeName } from '@/lib/themes'

interface ThemeState {
  theme: ThemeName
  setTheme: (theme: ThemeName) => void
  toggle: () => void
}

function applyTheme(theme: ThemeName): void {
  const el = document.documentElement
  // comic/neon 的深色令牌与 tailwind dark: 变体都挂在 .dark 类上
  el.classList.toggle('dark', theme !== 'paper')
  el.dataset.theme = theme
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'paper',
      setTheme: (theme) => {
        const safe = normalizeTheme(theme)
        applyTheme(safe)
        set({ theme: safe })
      },
      toggle: () => {
        const next = nextTheme(normalizeTheme(get().theme))
        applyTheme(next)
        set({ theme: next })
      }
    }),
    {
      name: 'yudu-theme',
      version: 1,
      partialize: ({ theme }) => ({ theme }),
      // v0 存的是 mode × preset 二维组合，收敛后按原 preset 归并（纸墨深色/漫画浅色不再提供）
      migrate: (persisted) => ({
        theme: (persisted as { preset?: string } | undefined)?.preset === 'comic' ? 'comic' : 'paper'
      }),
      merge: (persisted, current) => ({
        ...current,
        theme: normalizeTheme((persisted as { theme?: unknown } | null)?.theme)
      }),
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme ?? 'paper')
      }
    }
  )
)

// 首帧即同步主题，避免闪白
applyTheme(useThemeStore.getState().theme)
