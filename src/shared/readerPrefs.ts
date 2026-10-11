import type { ReaderPrefs } from './types'

/** 旧配置、恢复的备份和 IPC 输入都可能缺字段或带非法值，只保留已知有效偏好。 */
export function normalizeReaderPrefs(input: ReaderPrefs): ReaderPrefs {
  const result: ReaderPrefs = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result
  for (const key of ['enhance', 'autoTrim', 'eyeSchedule', 'rtl'] as const)
    if (typeof input[key] === 'boolean') result[key] = input[key]
  const ranges = {
    sharpness: [0, 3],
    contrast: [0.5, 1.5],
    brightness: [0.3, 1.2],
    warmth: [0, 0.6],
    zoom: [0.5, 4]
  } as const
  for (const key of Object.keys(ranges) as Array<keyof typeof ranges>) {
    const value = input[key]
    if (typeof value === 'number' && Number.isFinite(value))
      result[key] = Math.max(ranges[key][0], Math.min(ranges[key][1], value))
  }
  if (['single', 'double', 'webtoon'].includes(input.mode ?? '')) result.mode = input.mode
  if (['width', 'height', 'original'].includes(input.fit ?? '')) result.fit = input.fit
  if ([0, 90, 180, 270].includes(input.rotate ?? -1)) result.rotate = input.rotate
  if (input.spreadOffset === 0 || input.spreadOffset === 1) result.spreadOffset = input.spreadOffset
  return result
}
