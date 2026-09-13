import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * 主题即成品：风格与明暗绑定，不再二维组合。
 * paper = 纸墨书斋（暖纸 + 朱砂 · 浅色），comic = 现代漫画（墨蓝黑 + 信号黄 · 深色）
 */
export type ThemeName = 'paper' | 'comic'

interface ThemeState {
  theme: ThemeName
  setTheme: (theme: ThemeName) => void
  toggle: () => void
}

function applyTheme(theme: ThemeName): void {
  const el = document.documentElement
  // comic 的深色令牌与 tailwind dark: 变体都挂在 .dark 类上
  el.classList.toggle('dark', theme === 'comic')
  el.dataset.theme = theme
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'paper',
      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      },
      toggle: () => {
        const next: ThemeName = get().theme === 'paper' ? 'comic' : 'paper'
        applyTheme(next)
        set({ theme: next })
      }
    }),
    {
      name: 'yiben-theme',
      version: 1,
      partialize: ({ theme }) => ({ theme }),
      // v0 存的是 mode × preset 二维组合，收敛后按原 preset 归并（纸墨深色/漫画浅色不再提供）
      migrate: (persisted) => ({
        theme: (persisted as { preset?: string } | undefined)?.preset === 'comic' ? 'comic' : 'paper'
      }),
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme ?? 'paper')
      }
    }
  )
)

// 首帧即同步主题，避免闪白
applyTheme(useThemeStore.getState().theme)
