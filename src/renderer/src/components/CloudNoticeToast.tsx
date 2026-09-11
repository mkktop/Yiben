import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CloudOff, Gauge, X } from 'lucide-react'
import type { CloudNotice } from '@shared/types'
import { cn } from '@/lib/utils'

/**
 * 云端风控/会话失效的全局提示（右下角）。
 * - 会话失效：常驻，提供「去网盘页」重新登录入口
 * - 触发限流：8 秒自动消失，提示稍后再试
 */
export function CloudNoticeToast() {
  const navigate = useNavigate()
  const [notice, setNotice] = useState<(CloudNotice & { id: number }) | null>(null)

  useEffect(() => {
    return window.yiben.events.onCloudNotice((payload) => {
      setNotice({ ...payload, id: Date.now() })
    })
  }, [])

  useEffect(() => {
    if (!notice || notice.kind === 'session') return
    const timer = setTimeout(() => setNotice(null), 8000)
    return () => clearTimeout(timer)
  }, [notice])

  if (!notice) return null
  const isSession = notice.kind === 'session'

  return (
    <div
      className={cn(
        'fixed bottom-6 right-6 z-[60] flex max-w-sm items-start gap-3 rounded-xl border px-4 py-3 shadow-2xl',
        isSession ? 'border-destructive/40 bg-background' : 'border-border bg-background'
      )}
    >
      {isSession ? (
        <CloudOff className="mt-0.5 size-4 shrink-0 text-destructive" />
      ) : (
        <Gauge className="mt-0.5 size-4 shrink-0 text-amber-500" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm">{notice.message}</p>
        {isSession && (
          <button
            className="mt-1.5 text-xs text-primary underline underline-offset-2"
            onClick={() => {
              setNotice(null)
              navigate('/cloud')
            }}
          >
            去网盘页重新连接
          </button>
        )}
      </div>
      <button
        className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={() => setNotice(null)}
        title="关闭"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
