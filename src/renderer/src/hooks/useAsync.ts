import { useEffect, useState } from 'react'
import { errorMessage } from '@/lib/utils'

export interface AsyncResult<T> {
  data: T | undefined
  error: string | null
}

/**
 * 极简异步数据钩子：deps 变化时重新拉取，并暴露错误文案。
 * 足够覆盖本项目的 IPC 拉取场景，不引入额外依赖。
 *
 * 注意：必须把失败也落到 error 上，否则 IPC 抛错时 data 永远是 undefined，
 * 页面会永久停在「加载中…」。
 */
export function useAsync<T>(fetcher: () => Promise<T>, deps: unknown[]): AsyncResult<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  // fetcher 引用不进依赖，由调用方通过 deps 控制刷新时机
  useEffect(() => {
    let alive = true
    setError(null)
    fetcher()
      .then((d) => {
        if (alive) setData(d)
      })
      .catch((err: unknown) => {
        if (!alive) return
        console.error('[async]', err)
        setError(errorMessage(err))
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, error }
}
