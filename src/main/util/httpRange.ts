/** 单段字节范围；null 表示无范围，false 表示无效或超出文件。 */
export function parseByteRange(
  value: string | null,
  size: number
): { start: number; end: number } | null | false {
  if (value === null) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match || (!match[1] && !match[2]) || size <= 0) return false
  if (!match[1]) {
    const suffix = Number(match[2])
    return Number.isSafeInteger(suffix) && suffix > 0
      ? { start: Math.max(0, size - suffix), end: size - 1 }
      : false
  }
  const start = Number(match[1])
  const end = match[2] ? Number(match[2]) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start)
    return false
  return { start, end: Math.min(end, size - 1) }
}
