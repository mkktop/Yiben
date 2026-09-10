import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeMode = 'dark' | 'light'

interface ThemeState {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  toggle: () => void
}

function applyTheme(mode: ThemeMode): void {
  document.documentElement.classList.toggle('dark', mode === 'dark')
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: 'dark',
      setMode: (mode) => {
        applyTheme(mode)
        set({ mode })
      },
      toggle: () => {
        const next: ThemeMode = get().mode === 'dark' ? 'light' : 'dark'
        applyTheme(next)
        set({ mode: next })
      }
    }),
    {
      name: 'yiben-theme',
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.mode)
      }
    }
  )
)

// 首帧即同步主题，避免闪白
applyTheme(useThemeStore.getState().mode)
