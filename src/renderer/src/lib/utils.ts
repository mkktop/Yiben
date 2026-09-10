import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * 提取可展示的错误文案。
 * Electron 的 IPC 报错形如
 * `Error invoking remote method 'series:remove': Error: 已有扫描任务在进行中`，
 * 这里剥掉前缀只留真正的信息。
 */
export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^.*?Error: /s, '').trim() || raw
}
