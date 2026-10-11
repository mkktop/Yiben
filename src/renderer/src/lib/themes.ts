export const THEMES = [
  { key: 'paper', label: '纸墨书斋', tone: '浅色', desc: '暖纸与朱砂，明亮柔和的书房', icon: 'sun' },
  { key: 'comic', label: '现代漫画', tone: '深色', desc: '墨蓝与信号黄，利落的漫画质感', icon: 'moon' },
  { key: 'neon', label: '霓虹夜读', tone: '深色', desc: '粉紫与青色，夜间的轻柔辉光', icon: 'sparkles' }
] as const

export type ThemeName = (typeof THEMES)[number]['key']

/** 旧版本或损坏的本地配置不能让主题轮换进入未知状态。 */
export function normalizeTheme(value: unknown): ThemeName {
  return value === 'comic' || value === 'neon' ? value : 'paper'
}

export function nextTheme(theme: ThemeName, direction = 1): ThemeName {
  const index = THEMES.findIndex((item) => item.key === theme)
  return THEMES[(index + direction + THEMES.length) % THEMES.length].key
}
