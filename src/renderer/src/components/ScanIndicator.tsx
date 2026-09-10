import { useEffect } from 'react'
import { TriangleAlert, X } from 'lucide-react'
import { useScanStore, useDataStore } from '@/stores/data'
import { cn } from '@/lib/utils'

/** 扫描错误/告警提示的停留时间 */
const NOTICE_MS = 8000

/**
 * 右下角扫描浮标：订阅主进程 scan:progress / scan:notice。
 * 失败时主进程会补发 done，所以浮标不会再永久卡住；原因通过 notice 卡片展示。
 */
export function ScanIndicator() {
  const { active, current, total, title, notice, setProgress, setNotice } = useScanStore()
  const bump = useDataStore((s) => s.bump)

  useEffect(() => {
    const offProgress = window.yiben.events.onScanProgress((p) => {
      const payload = p as { phase: string; current?: number; total?: number; title?: string }
      setProgress(payload)
      // 新一轮扫描开始：清掉上一轮的提示
      if (payload.phase !== 'done') setNotice(null)
      if (payload.phase === 'done') bump()
    })
    const offNotice = window.yiben.events.onScanNotice((n) => setNotice(n))
    return () => {
      offProgress()
      offNotice()
    }
  }, [setProgress, setNotice, bump])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice, setNotice])

  if (notice) {
    const isError = notice.level === 'error'
    return (
      <div
        className={cn(
          'fixed right-6 bottom-6 z-50 w-80 rounded-xl border p-4 shadow-xl backdrop-blur',
          isError
            ? 'border-destructive/50 bg-destructive/10'
            : 'border-amber-500/50 bg-amber-500/10'
        )}
      >
        <div className="flex items-start gap-2">
          <TriangleAlert
            className={cn('mt-0.5 size-4 shrink-0', isError ? 'text-destructive' : 'text-amber-500')}
          />
          <p className="min-w-0 flex-1 text-xs font-medium">
            {isError ? '扫描失败' : '扫描提示'}
          </p>
          <button
            onClick={() => setNotice(null)}
            className="-mt-1 -mr-1 grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground"
            title="关闭"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <p className="mt-1.5 break-words pl-6 text-xs text-muted-foreground">{notice.message}</p>
      </div>
    )
  }

  if (!active) return null

  const pct = total > 0 ? Math.round((current / total) * 100) : 0

  return (
    <div className="fixed right-6 bottom-6 z-50 w-72 rounded-xl border bg-card/95 p-4 shadow-xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-medium">正在扫描书库</span>
        <span className="text-muted-foreground">
          {current}/{total}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 truncate text-xs text-muted-foreground">{title}</p>
    </div>
  )
}
