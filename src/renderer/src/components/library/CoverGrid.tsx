import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { BookOpen } from 'lucide-react'
import type { Series } from '@shared/types'
import { Skeleton } from '@/components/ui/skeleton'
import { CoverImage } from './CoverImage'

export function CoverCard({ series }: { series: Series }) {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => navigate(`/series/${series.id}`)}
      className="group w-full text-left"
      title={series.title}
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-muted shadow-sm transition-all duration-200 group-hover:shadow-lg group-hover:ring-2 group-hover:ring-primary/60">
        <CoverImage
          seriesId={series.id}
          title={series.title}
          className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2.5 pt-8 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <p className="line-clamp-2 text-xs font-medium text-white">{series.title}</p>
        </div>
      </div>
      <p className="mt-2 line-clamp-1 text-sm font-medium">{series.title}</p>
      <p className="line-clamp-1 text-xs text-muted-foreground">{series.author ?? ''}</p>
    </button>
  )
}

function CoverCardSkeleton() {
  return (
    <div>
      <Skeleton className="aspect-[3/4] w-full rounded-lg" />
      <Skeleton className="mt-2 h-3.5 w-3/4" />
    </div>
  )
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center py-20 text-center text-muted-foreground">
      <BookOpen className="mb-3 size-8 text-muted-foreground/50" />
      <div className="text-sm">{children}</div>
    </div>
  )
}

interface CoverGridProps {
  series: Series[] | undefined
  loading?: boolean
  emptyHint?: ReactNode
}

const MIN_COL_WIDTH = 172
const ROW_ESTIMATE = 262

/** 封面墙：按容器宽度定列数，按行虚拟滚动 */
export function CoverGrid({ series, loading, emptyHint }: CoverGridProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1200)

  // 列数必须跟着窗口宽度走：render 期读 clientWidth 拿到的是首帧的旧值，且缩放后不会重算
  useEffect(() => {
    const el = parentRef.current
    if (!el) return
    const update = (): void => setWidth(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const columns = Math.max(2, Math.floor((width - 16) / MIN_COL_WIDTH))

  const count = loading ? 18 : (series?.length ?? 0)
  const rows = Math.ceil(count / columns)

  const rowVirtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 2
  })

  if (!loading && count === 0) {
    return <EmptyHint>{emptyHint ?? '这里还是空的'}</EmptyHint>
  }

  const items = loading ? Array.from({ length: 18 }).map(() => null) : series!

  return (
    <div ref={parentRef} className="h-full overflow-y-auto">
      <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
        {rowVirtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${row.start}px)`
            }}
          >
            <div
              className="grid gap-x-5 gap-y-6 pb-6"
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            >
              {items.slice(row.index * columns, row.index * columns + columns).map((s, i) =>
                s ? (
                  <CoverCard key={s.id} series={s} />
                ) : (
                  <CoverCardSkeleton key={`sk-${i}`} />
                )
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
