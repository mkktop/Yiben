import { useEffect, useMemo } from 'react'
import { useScanStore, useDataStore } from '@/stores/data'
import { useToastStore } from '@/stores/toast'
import { createScanRefresher } from '@/lib/scanRefresh'

/** 扫描错误/告警提示的停留时间 */
const NOTICE_MS = 8000

/** 扫描提示在全局 Toast 队列里的固定槽位 */
const SLOT = 'scan-notice'

/**
 * 扫描浮标：订阅主进程 scan:progress / scan:notice。
 * 失败时主进程会补发 done，所以浮标不会再永久卡住；原因推入全局 Toast（与其他来源堆叠展示）。
 */
export function ScanIndicator() {
  const { active, current, total, title, notice, setProgress, setNotice } = useScanStore()
  const bump = useDataStore((s) => s.bump)
  const push = useToastStore((s) => s.push)
  const close = useToastStore((s) => s.close)
  const refresh = useMemo(() => createScanRefresher(bump), [bump])

  useEffect(() => {
    const offProgress = window.yudu.events.onScanProgress((p) => {
      const payload = p as { phase: string; current?: number; total?: number; title?: string }
      setProgress(payload)
      // 新一轮扫描开始：清掉上一轮的提示
      if (payload.phase !== 'done') setNotice(null)
      // 扫描中节流刷新书架（新入库系列边扫边出），done 终态必刷
      refresh(payload.phase)
    })
    const offNotice = window.yudu.events.onScanNotice((n) => setNotice(n))
    return () => {
      offProgress()
      offNotice()
    }
  }, [setProgress, setNotice, refresh])

  useEffect(() => {
    if (!notice) {
      close(SLOT)
      return
    }
    const isError = notice.level === 'error'
    push({
      id: SLOT,
      kind: isError ? 'error' : 'warning',
      title: isError ? '扫描失败' : '扫描提示',
      children: <p className="break-words">{notice.message}</p>
    })
    const timer = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice, push, close, setNotice])

  if (notice || !active) return null

  const pct = total > 0 ? Math.round((current / total) * 100) : 0

  return (
    <div className="fixed right-6 bottom-6 z-50 w-72 rounded-xl border bg-card/95 p-4 shadow-lg backdrop-blur">
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
