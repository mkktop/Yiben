import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { BookOpen, Check } from 'lucide-react'
import type { Series } from '@shared/types'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { CoverImage } from './CoverImage'

export interface GridSelection {
  selected: Set<number>
  onToggle: (id: number) => void
}

export function CoverCard({
  series,
  selection
}: {
  series: Series
  selection?: GridSelection | null
}) {
  const navigate = useNavigate()
  const checked = selection?.selected.has(series.id) ?? false
  return (
    <button
      onClick={() => (selection ? selection.onToggle(series.id) : navigate(`/series/${series.id}`))}
      className="group w-full text-left"
      title={series.title}
    >
      <div
        className={cn(
          'relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-muted shadow-sm transition-all duration-200',
          selection
            ? checked
              ? 'ring-2 ring-primary'
              : 'group-hover:ring-2 group-hover:ring-primary/40'
            : 'group-hover:shadow-lg group-hover:ring-2 group-hover:ring-primary/60'
        )}
      >
        <CoverImage
          seriesId={series.id}
          title={series.title}
          className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
        />
        {selection && (
          <span
            className={cn(
              'absolute right-2 top-2 grid size-6 place-items-center rounded-full border-2 transition-colors',
              checked
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-white/70 bg-black/40 text-transparent'
            )}
          >
            <Check className="size-4" />
          </span>
        )}
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
  /** 批量选择模式：传入后点封面变为切换选中 */
  selection?: GridSelection | null
}

const MIN_COL_WIDTH = 172
const ROW_ESTIMATE = 262

/** 按路由记忆滚动位置：从详情页返回书架时回到离开时的位置（虚拟列表换页即重挂） */
const scrollMemory = new Map<string, number>()

/** 封面墙：按容器宽度定列数，按行虚拟滚动 */
export function CoverGrid({ series, loading, emptyHint, selection }: CoverGridProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1200)
  const location = useLocation()

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
    // 实际行高（3:4 封面 + 两行文字 + 行距）与估算值偏差不小：挂 ref 实测，
    // 滚动条长度与跳页定位才准
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan: 2
  })

  // 返回本页时恢复滚动位置；数据未到齐前恢复不到位，每帧重试直到成功
  const restoredRef = useRef(false)
  useEffect(() => {
    const el = parentRef.current
    if (!el) return
    const saved = scrollMemory.get(location.pathname) ?? 0
    if (!restoredRef.current && saved > 0 && count > 0) {
      el.scrollTop = saved
      if (el.scrollTop > 0) restoredRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, location.pathname])
  useEffect(
    () => () => {
      const el = parentRef.current
      if (el) scrollMemory.set(location.pathname, el.scrollTop)
    },
    [location.pathname]
  )

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
            data-index={row.index}
            ref={rowVirtualizer.measureElement}
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
                  <CoverCard key={s.id} series={s} selection={selection} />
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
