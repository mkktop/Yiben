import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BookOpen } from 'lucide-react'
import { coverUrl } from '@shared/types'
import { cn } from '@/lib/utils'

/** 封面加载失败后的重试次数（云端封面是首次请求时现生成的，可能先返回 503） */
const RETRIES = 2
const RETRY_MS = 1500

interface CoverImageProps {
  seriesId: number
  title: string
  className?: string
  loading?: 'lazy' | 'eager'
  /** 加载失败时的兜底内容，默认书本占位 */
  fallback?: ReactNode
}

/**
 * 系列封面：失败后延迟重试（换查询串强制重新请求，协议层忽略查询串），
 * 重试仍失败则渲染兜底占位，避免留下一个裂图图标。
 */
export function CoverImage({
  seriesId,
  title,
  className,
  loading = 'lazy',
  fallback
}: CoverImageProps) {
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 虚拟滚动滑出后组件卸载：挂起的重试定时器必须清掉，避免对已卸载组件 setState
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const handleError = (): void => {
    if (attempt >= RETRIES) {
      setFailed(true)
      return
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setAttempt((a) => a + 1), RETRY_MS)
  }

  if (failed) {
    return (
      <>
        {fallback ?? (
          <div className={cn('grid place-items-center', className)}>
            <BookOpen className="size-6 text-muted-foreground/50" />
          </div>
        )}
      </>
    )
  }

  return (
    <img
      src={attempt > 0 ? `${coverUrl(seriesId)}?r=${attempt}` : coverUrl(seriesId)}
      alt={title}
      loading={loading}
      draggable={false}
      onError={handleError}
      className={className}
    />
  )
}
