import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRightToLine,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Columns2,
  GalleryVertical,
  Keyboard,
  Maximize,
  Minimize,
  RotateCw,
  Sheet,
  X,
  type LucideIcon
} from 'lucide-react'
import { useReaderStore, spreadPages, atLastScreen, type ReaderMode } from '@/stores/reader'
import { pageThumbUrl, type BookmarkInfo } from '@shared/types'
import { cn } from '@/lib/utils'
import { WindowControls } from '@/components/layout/WindowControls'
import { Button } from '@/components/ui/button'
import { KeyboardHelp } from './KeyboardHelp'
import type { ReaderHint } from './ReaderPage'

interface NeighborChapter {
  id: number
  title: string
  page_count: number
  kind: string
}

export interface ReaderChromeProps {
  chapterId: number
  seriesTitle: string
  chapterTitle: string
  /** PDF 没有逐页图片（pdfjs 直接渲染 canvas），缩略图条不可用 */
  canThumbnail: boolean
  isFullscreen: boolean
  toggleFullscreen: () => void
  onModeChange: (m: ReaderMode) => void
  /** 直接跳前后话（顶栏按钮/末页卡片用） */
  onNextChapter: () => void
  onPrevChapter: () => void
  neighbors: { index: number; total: number; prev: NeighborChapter | null; next: NeighborChapter | null } | null
  bookmarks: BookmarkInfo[]
  isBookmarked: boolean
  onToggleBookmark: () => void
  /** 跳页：同话直接定位；跨话（书签）带章节 id */
  onJump: (chapterId: number, page0: number) => void
  /** 返回（ReaderPage 持有，带兜底逻辑） */
  onBack: () => void
  /** 条漫跨话拼接：下一话已在同一条带里，末页提示卡不再展示 */
  hideEndCard?: boolean
  /** 跨页配对切换（C 键与顶栏按钮共用） */
  onToggleSpreadOffset: () => void
  /** 底部提示浮层（阅读方向 / 跨页配对反馈），ReaderPage 持有状态 */
  hint: ReaderHint | null
  onHintClose: () => void
  /** 浮层面板（快捷键与按钮共用同一状态，由 ReaderPage 持有） */
  panel: 'none' | 'bookmarks' | 'help'
  onPanelChange: (p: 'none' | 'bookmarks' | 'help') => void
}

const MODES: Array<{ key: ReaderMode; label: string; icon: LucideIcon }> = [
  { key: 'single', label: '单页', icon: Sheet },
  { key: 'double', label: '双页', icon: Columns2 },
  { key: 'webtoon', label: '条漫', icon: GalleryVertical }
]

export function ReaderChrome({
  chapterId,
  seriesTitle,
  chapterTitle,
  canThumbnail,
  isFullscreen,
  toggleFullscreen,
  onModeChange,
  onNextChapter,
  onPrevChapter,
  neighbors,
  bookmarks,
  isBookmarked,
  onToggleBookmark,
  onJump,
  onBack,
  onToggleSpreadOffset,
  hint,
  onHintClose,
  panel,
  onPanelChange,
  hideEndCard
}: ReaderChromeProps) {
  // 细粒度订阅：顶栏只关心自己展示/操作的字段，避免跟随无关状态整树 reconcile
  const mode = useReaderStore((s) => s.mode)
  const fit = useReaderStore((s) => s.fit)
  const rtl = useReaderStore((s) => s.rtl)
  const rotate = useReaderStore((s) => s.rotate)
  const page = useReaderStore((s) => s.page)
  const pageCount = useReaderStore((s) => s.pageCount)
  const widePages = useReaderStore((s) => s.widePages)
  const spreadOffset = useReaderStore((s) => s.spreadOffset)
  const immersive = useReaderStore((s) => s.immersive)
  const showThumbs = useReaderStore((s) => s.showThumbs)
  const setPage = useReaderStore((s) => s.setPage)
  const patch = useReaderStore((s) => s.patch)
  const toggleThumbs = useReaderStore((s) => s.toggleThumbs)

  const spread = spreadPages(page, pageCount, rtl, widePages, spreadOffset)
  const lo = Math.min(...spread) + 1
  const hi = Math.max(...spread) + 1
  const currentDisplay =
    mode === 'webtoon' || lo === hi
      ? `${page + 1} / ${pageCount}`
      : `${lo}-${hi} / ${pageCount}`
  // 与 ReaderPage.goNext 的边界判定共用同一函数：末页卡片出现的时机 = 翻页会进下一话的时机
  const atEnd = atLastScreen(page, pageCount, mode, widePages, spreadOffset)

  return (
    <>
      {/* 顶栏：悬浮毛玻璃条，m-3 距边缘 */}
      <div
        className={cn(
          'absolute inset-x-3 top-3 z-20 flex h-12 items-center gap-1.5 overflow-hidden rounded-xl border border-border/50 bg-background/80 pl-3 text-foreground shadow-lg backdrop-blur-md transition-opacity duration-300 [-webkit-app-region:drag]',
          immersive ? 'pointer-events-none opacity-0' : 'opacity-100'
        )}
      >
        <button
          onClick={onBack}
          className="grid size-8 place-items-center rounded-full text-foreground/80 transition-colors [-webkit-app-region:no-drag] hover:bg-accent hover:text-foreground"
          title="返回 (Esc)"
        >
          <ArrowLeft className="size-4" />
        </button>
        {/* 跨话导航：直接跳前后话，与翻页无关 */}
        <button
          onClick={onPrevChapter}
          disabled={!neighbors?.prev}
          className="grid size-8 place-items-center rounded-full text-foreground/80 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-25"
          title={neighbors?.prev ? `上一话：${neighbors.prev.title}` : '没有上一话'}
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          onClick={onNextChapter}
          disabled={!neighbors?.next}
          className="grid size-8 place-items-center rounded-full text-foreground/80 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-25"
          title={neighbors?.next ? `下一话：${neighbors.next.title}` : '没有下一话'}
        >
          <ChevronRight className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {seriesTitle}
            <span className="mx-2 text-muted-foreground/40">/</span>
            <span className="text-muted-foreground">{chapterTitle}</span>
          </p>
        </div>
        <PageJump
          display={currentDisplay}
          page={page}
          onJump={(page0) => onJump(chapterId, page0)}
        />
        <div className="mx-1 h-5 w-px bg-border/60" />
        <IconBtn
          title={`书签：当前页${isBookmarked ? '已加' : '未加'}（B）`}
          active={isBookmarked}
          onClick={onToggleBookmark}
        >
          <Bookmark className={cn(isBookmarked && 'fill-current')} />
        </IconBtn>
        <IconBtn
          title={`书签列表（${bookmarks.length}）`}
          active={panel === 'bookmarks'}
          onClick={() => onPanelChange(panel === 'bookmarks' ? 'none' : 'bookmarks')}
        >
          <BookmarksGlyph />
        </IconBtn>
        <IconBtn
          title={`方向：${rtl ? '日漫（从右往左）' : '西漫（从左往右）'}（D 切换）`}
          onClick={() => patch({ rtl: !rtl })}
        >
          <ArrowRightToLine className={cn(rtl && 'scale-x-[-1]')} />
        </IconBtn>
        {mode === 'double' && canThumbnail && (
          <IconBtn
            title={`跨页配对（C）：${spreadOffset === 1 ? '第 1 页单独' : '从第 1 页起两两配对'}`}
            active={spreadOffset === 1}
            onClick={onToggleSpreadOffset}
          >
            <SpreadGlyph />
          </IconBtn>
        )}
        <IconBtn
          title={`适配：${fit === 'width' ? '适宽' : fit === 'height' ? '适高' : '原始'}（S 切换）`}
          onClick={() =>
            patch({ fit: fit === 'width' ? 'height' : fit === 'height' ? 'original' : 'width' })
          }
        >
          <span className="text-[11px] font-semibold">
            {fit === 'width' ? '宽' : fit === 'height' ? '高' : '原'}
          </span>
        </IconBtn>
        <IconBtn
          title="旋转（R）"
          onClick={() => patch({ rotate: ((rotate + 90) % 360) as number })}
        >
          <RotateCw />
        </IconBtn>
        {canThumbnail && (
          <IconBtn title="缩略图（T）" active={showThumbs} onClick={toggleThumbs}>
            <Sheet />
          </IconBtn>
        )}
        <IconBtn title="快捷键（?）" active={panel === 'help'} onClick={() => onPanelChange(panel === 'help' ? 'none' : 'help')}>
          <Keyboard />
        </IconBtn>
        <IconBtn title={isFullscreen ? '退出全屏' : '全屏（F）'} onClick={toggleFullscreen}>
          {isFullscreen ? <Minimize /> : <Maximize />}
        </IconBtn>
        <WindowControls />
      </div>

      {/* 模式切换（左下悬浮毛玻璃） */}
      <div
        className={cn(
          'absolute bottom-3 left-3 z-20 flex gap-1 rounded-xl border border-border/50 bg-background/80 p-1 shadow-lg backdrop-blur-md transition-opacity duration-300',
          immersive ? 'pointer-events-none opacity-0' : 'opacity-100'
        )}
      >
        {MODES.map((m) => (
          <button
            key={m.key}
            onClick={() => onModeChange(m.key)}
            title={`${m.label}模式（M 循环切换）`}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs transition-colors',
              mode === m.key
                ? 'bg-primary font-medium text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            <m.icon className="size-3.5" />
            {m.label}
          </button>
        ))}
      </div>

      {/* 末页提示卡：居中卡片，直接进下一话（键盘/点击继续翻页也会自动进入）；
          条漫跨话拼接时下一话已在同一条带里，卡就不必再出现 */}
      {atEnd && neighbors?.next && !hideEndCard && (
        <div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
          <div className="animate-scale-in w-80 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-border/50 bg-background/80 p-5 text-center text-foreground shadow-lg backdrop-blur-md">
            <p className="text-[11px] font-medium tracking-[0.25em] text-muted-foreground">
              本话完
            </p>
            <p className="mt-1.5 truncate text-sm font-semibold">{neighbors.next.title}</p>
            <div className="mt-4 flex items-center gap-2">
              <Button className="flex-1" onClick={onNextChapter}>
                进入下一话
                <ChevronRight />
              </Button>
              <Button variant="ghost" className="flex-1" onClick={onBack}>
                返回书架
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 底部进度条 */}
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 z-10 h-1 bg-white/10 transition-opacity',
          immersive ? 'opacity-0' : 'opacity-100'
        )}
      >
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${pageCount > 1 ? (page / (pageCount - 1)) * 100 : 100}%` }}
        />
      </div>

      {/* 缩略图条（底部悬浮毛玻璃） */}
      {showThumbs && canThumbnail && (
        <div
          className={cn(
            'absolute inset-x-3 bottom-3 z-20 flex h-28 items-center gap-2 overflow-x-auto rounded-xl border border-border/50 bg-background/80 px-3 shadow-lg backdrop-blur-md transition-opacity',
            immersive ? 'pointer-events-none opacity-0' : 'opacity-100'
          )}
        >
          {Array.from({ length: pageCount }, (_, p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={cn(
                'relative h-20 shrink-0 overflow-hidden rounded-lg border-2 transition-all',
                p === page ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100'
              )}
              title={`第 ${p + 1} 页`}
            >
              <img src={pageThumbUrl(chapterId, p)} alt="" className="h-full w-auto" loading="lazy" />
              <span className="absolute bottom-0 right-0 bg-black/60 px-1 text-[10px] tabular-nums text-white">
                {p + 1}
              </span>
              {bookmarks.some((b) => b.chapter_id === chapterId && b.page === p) && (
                <Bookmark className="absolute left-0.5 top-0.5 size-3 fill-primary text-primary" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* 书签列表面板 */}
      {panel === 'bookmarks' && (
        <Panel title={`书签（${bookmarks.length}）`} onClose={() => onPanelChange('none')}>
          {bookmarks.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              还没有书签。阅读时按 B 收藏当前页。
            </p>
          ) : (
            bookmarks.map((b) => (
              <button
                key={`${b.chapter_id}-${b.page}`}
                onClick={() => {
                  onPanelChange('none')
                  onJump(b.chapter_id, b.page)
                }}
                className="flex w-full items-center gap-3 border-b border-border/60 px-4 py-2.5 text-left text-sm last:border-0 hover:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate">{b.chapter_title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">第 {b.page + 1} 页</span>
              </button>
            ))
          )}
        </Panel>
      )}

      {/* 提示浮层：进入阅读器时的方向提示 / 跨页配对操作反馈 */}
      {hint && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-24 z-30 flex justify-center"
          onClick={onHintClose}
        >
          {hint.kind === 'direction' ? (
            <div className="hint-pop pointer-events-auto flex flex-col items-center gap-2 rounded-xl border border-border/50 bg-background/80 px-8 py-5 text-foreground shadow-lg backdrop-blur-md">
              <div className={cn('flex items-center gap-1 text-primary', hint.rtl && 'scale-x-[-1]')}>
                <span className="text-2xl leading-none">→</span>
                <span className="text-2xl leading-none">📖</span>
              </div>
              <p className="text-sm font-medium">
                翻页方向：{hint.rtl ? '从右往左（日漫）' : '从左往右（西漫）'}
              </p>
              <p className="text-xs text-muted-foreground">点击区域与翻页键都跟随这个方向，D 键可切换</p>
            </div>
          ) : (
            <div className="hint-pop pointer-events-auto rounded-xl border border-border/50 bg-background/80 px-5 py-2.5 text-sm text-foreground shadow-lg backdrop-blur-md">
              {hint.text}
            </div>
          )}
        </div>
      )}

      {/* 快捷键帮助：居中模态键盘图 */}
      {panel === 'help' && <KeyboardHelp onClose={() => onPanelChange('none')} />}
    </>
  )
}

/** 跨页配对图标：两页并排加一条错位分隔线 */
function SpreadGlyph(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="5" width="8" height="14" rx="1" />
      <rect x="13" y="5" width="8" height="14" rx="1" strokeDasharray="3 2" />
    </svg>
  )
}

/** 书签集合图标（顶栏） */
function BookmarksGlyph(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 3h8v18l-4-3-4 3z" />
      <path d="M18 3v18" strokeDasharray="2 2" />
    </svg>
  )
}

/** 顶栏页码：点击变成输入框回车跳页 */
function PageJump({
  display,
  page,
  onJump
}: {
  display: string
  page: number
  onJump: (page0: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setValue(String(page + 1))
      // 等输入框挂载后聚焦并全选
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [editing, page])

  if (!editing) {
    return (
      <button
        className="shrink-0 rounded-full px-1.5 py-1 text-xs tabular-nums text-muted-foreground transition-colors [-webkit-app-region:no-drag] hover:bg-accent hover:text-foreground"
        title="点击输入页码跳转"
        onClick={() => setEditing(true)}
      >
        {display}
      </button>
    )
  }

  const commit = (): void => {
    const n = Number.parseInt(value, 10)
    if (Number.isFinite(n) && n >= 1) onJump(n - 1)
    setEditing(false)
  }

  return (
    <input
      ref={inputRef}
      value={value}
      inputMode="numeric"
      onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ''))}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setEditing(false)
        e.stopPropagation()
      }}
      className="w-16 shrink-0 rounded-md border border-border/60 bg-muted/60 px-1.5 py-1 text-center text-xs tabular-nums text-foreground outline-none [-webkit-app-region:no-drag]"
    />
  )
}

function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="animate-scale-in absolute right-3 top-[4.5rem] z-30 w-80 max-w-[calc(100vw-1.5rem)] origin-top-right overflow-hidden rounded-2xl border border-border/50 bg-background/80 shadow-lg backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <button
          onClick={onClose}
          className="grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="max-h-96 overflow-y-auto">{children}</div>
    </div>
  )
}

function IconBtn({
  title,
  onClick,
  active,
  children
}: {
  title: string
  onClick: () => void
  active?: boolean
  children: ReactNode
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-full text-foreground/80 transition-colors [-webkit-app-region:no-drag] hover:bg-accent hover:text-foreground [&_svg]:size-4',
        active ? 'bg-primary/15 text-primary hover:bg-primary/25 hover:text-primary' : ''
      )}
    >
      {children}
    </button>
  )
}
