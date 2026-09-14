import { useEffect, useState } from 'react'

/**
 * 延迟跟随值：搜索输入每敲一键就触发拉取的场景（书库列表一次序列化数千条）
 * 只发停顿后的最终请求；中间值全部跳过，输入框本身保持即时回显。
 */
export function useDebounced<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}
