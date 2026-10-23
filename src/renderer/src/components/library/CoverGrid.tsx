import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { BookOpen, Check } from 'lucide-react'
import type { Series } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { CoverImage } from './CoverImage'

export interface GridSelection {
  selected: Set<number>
  onToggle: (id: number) => void
}

export function CoverCard({
  series,
  selection,
  read,
  progress
}: {
  series: Series
  selection?: GridSelection | null
  /** 系列全部章节读完时点亮右上角对勾徽章（seriesStatus 推导） */
  read?: boolean
  /** 已读比例 0..1，在读未完时显示封面底部进度条 */
  progress?: number
}) {
  const navigate = useNavigate()
  const checked = selection?.selected.has(series.id) ?? false
  const reading = progress !== undefined && progress > 0 && progress < 1
  const started = (series.started_chapters ?? series.read_chapters ?? 0) > 0
  const status = read ? '已读完' : started ? '在读' : '未读'
  return (
    <button
      onClick={() => (selection ? selection.onToggle(series.id) : navigate(`/series/${series.id}`))}
      className="group w-full text-left"
      title={series.title}
      aria-pressed={selection ? checked : undefined}
      data-series-card={series.id}
    >
      <div
        className={cn(
          'relative aspect-[3/4] w-full overflow-hidden rounded-xl bg-muted shadow-md transition-all duration-200',
          selection
            ? checked
              ? 'ring-2 ring-primary'
              : 'group-hover:ring-2 group-hover:ring-primary/40'
            : 'group-hover:-translate-y-1 group-hover:shadow-lg'
        )}
      >
        <CoverImage
          seriesId={series.id}
          title={series.title}
          className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
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
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent p-2.5 pt-8 opacity-60 transition-opacity duration-200 group-hover:opacity-100">
          <p className="line-clamp-2 text-xs font-medium text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">
            {series.total_chapters !== undefined && `共 ${series.total_chapters} 话 · `}{status}
            {reading && ` ${Math.min(99, Math.max(1, Math.round(progress * 100)))}%`}
          </p>
        </div>
        {/* 已读完徽章：非选择模式才显示（右上角让位给勾选框） */}
        {!selection && read && (
          <span aria-label="已读完" className="absolute right-2 top-2 z-10 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm">
            <Check className="size-3" />
          </span>
        )}
        {/* 在读未完：底部 3px 主色进度条，宽度按已读比例 */}
        {!selection && reading && (
          <span
            className="absolute bottom-0 left-0 z-10 h-[3px] bg-primary"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        )}
      </div>
      <p className="mt-2 line-clamp-1 text-sm font-medium transition-colors duration-200 group-hover:text-primary">
        {series.title}
      </p>
      <p className="h-4 line-clamp-1 text-xs text-muted-foreground">{series.author ?? ''}</p>
    </button>
  )
}

function CoverCardSkeleton() {
  return (
    <div>
      <Skeleton className="aspect-[3/4] w-full rounded-xl" />
      <Skeleton className="mt-2 h-3.5 w-3/4" />
    </div>
  )
}

export function EmptyHint({
  children,
  hint,
  action
}: {
  /** 主文案（text-sm font-medium） */
  children: ReactNode
  /** 副文案（text-xs 弱化的第二行） */
  hint?: ReactNode
  /** 主色行动按钮，如「去书架添加」 */
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden py-20 text-center">
      {/* 品牌水印：超大半透明衬线「一」 */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 grid select-none place-items-center font-serif text-[10rem] font-bold leading-none text-foreground/[0.12] dark:text-foreground/[0.16]"
      >
        一
      </span>
      <BookOpen className="relative mb-3 size-10 text-muted-foreground/50" />
      <div className="relative text-sm font-medium text-foreground">{children}</div>
      {hint !== undefined && (
        <div className="relative mt-1.5 text-xs text-muted-foreground">{hint}</div>
      )}
      {action && (
        <Button variant="default" size="sm" className="relative mt-6" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}

/**
 * 已读徽章由完成话数决定；进度包含未完话的页码，未知页数仍可显示在读文案。
 */
export function seriesStatus(s: Series): { read?: boolean; progress?: number } {
  const total = s.total_chapters ?? 0
  const read = s.read_chapters ?? 0
  if (total <= 0) return {}
  const progress = (s.chapter_progress ?? read) / total
  return { read: read >= total, progress: read >= total ? 1 : Math.min(0.99, progress) }
}

interface CoverGridProps {
  series: Series[] | undefined
  loading?: boolean
  emptyHint?: ReactNode
  /** 批量选择模式：传入后点封面变为切换选中 */
  selection?: GridSelection | null
  /** 搜索及筛选组合各自记住位置，切换条件不会沿用另一份列表的位置。 */
  memoryKey?: string
}

const MIN_COL_WIDTH = 172

/** 按搜索和筛选组合记忆滚动位置，返回详情前的那份列表。 */
const scrollMemory = new Map<string, number>()

/** 封面墙：按容器宽度定列数，按行虚拟滚动 */
export function CoverGrid({ series, loading, emptyHint, selection, memoryKey = 'library' }: CoverGridProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const savedOffset = useRef(scrollMemory.get(memoryKey) ?? 0)
  const restoredRef = useRef(false)

  // 列数必须跟着窗口宽度走：render 期读 clientWidth 拿到的是首帧的旧值，且缩放后不会重算
  useLayoutEffect(() => {
    const el = parentRef.current
    if (!el) return
    const update = (): void => setWidth(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const columns = Math.max(2, Math.floor((width - 16) / MIN_COL_WIDTH))
  // 封面 3:4、列距 20px，文字两行与下方间距共 68px；固定行高避免恢复时估算值二次跳动。
  const rowHeight = ((width - (columns - 1) * 20) / columns) * 4 / 3 + 68

  const count = loading ? 18 : (series?.length ?? 0)
  const rows = Math.ceil(count / columns)

  const rowVirtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 2
  })

  // 列数不变时缩放也会改变封面高度，清掉旧的行尺寸缓存。
  useLayoutEffect(() => rowVirtualizer.measure(), [rowVirtualizer, rowHeight])

  // 等真实数据和实测行高就绪后恢复；卸载时 ref 已清空，位置改在滚动事件中保存。
  useLayoutEffect(() => {
    const el = parentRef.current
    if (!el || loading || width === 0 || restoredRef.current) return
    const frame = requestAnimationFrame(() => {
      el.scrollTop = savedOffset.current
      restoredRef.current = true
    })
    return () => cancelAnimationFrame(frame)
  }, [loading, count, width])

  const items = loading ? Array.from({ length: 18 }).map(() => null) : (series ?? [])

  return (
    <div ref={parentRef} data-cover-grid className="h-full overflow-y-auto" onScroll={(event) => {
      if (restoredRef.current && !loading) scrollMemory.set(memoryKey, event.currentTarget.scrollTop)
    }}>
      {!loading && count === 0 && <EmptyHint>{emptyHint ?? '这里还是空的'}</EmptyHint>}
      <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
        {rowVirtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            data-index={row.index}
            style={{
              height: rowHeight,
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
              {items.slice(row.index * columns, row.index * columns + columns).map((s, i) => {
                if (!s) return <CoverCardSkeleton key={`sk-${i}`} />
                const st = seriesStatus(s)
                return (
                  <CoverCard
                    key={s.id}
                    series={s}
                    selection={selection}
                    read={st.read}
                    progress={st.progress}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
