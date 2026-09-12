import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeMode = 'dark' | 'light'
/** 主题风格：paper = 纸墨书斋（暖纸+朱砂），comic = 现代漫画（油墨+钴蓝/信号黄） */
export type ThemePreset = 'paper' | 'comic'

interface ThemeState {
  mode: ThemeMode
  preset: ThemePreset
  setMode: (mode: ThemeMode) => void
  setPreset: (preset: ThemePreset) => void
  toggle: () => void
}

function applyTheme(mode: ThemeMode, preset: ThemePreset): void {
  const el = document.documentElement
  el.classList.toggle('dark', mode === 'dark')
  el.dataset.theme = preset
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: 'dark',
      preset: 'paper',
      setMode: (mode) => {
        applyTheme(mode, get().preset)
        set({ mode })
      },
      setPreset: (preset) => {
        applyTheme(get().mode, preset)
        set({ preset })
      },
      toggle: () => {
        const next: ThemeMode = get().mode === 'dark' ? 'light' : 'dark'
        applyTheme(next, get().preset)
        set({ mode: next })
      }
    }),
    {
      name: 'yiben-theme',
      onRehydrateStorage: () => (state) => {
        // 旧版本只存了 mode：preset 缺省时回落 paper， shallow merge 会补齐默认值
        if (state) applyTheme(state.mode, state.preset ?? 'paper')
      }
    }
  )
)

// 首帧即同步主题，避免闪白
applyTheme(useThemeStore.getState().mode, useThemeStore.getState().preset)
