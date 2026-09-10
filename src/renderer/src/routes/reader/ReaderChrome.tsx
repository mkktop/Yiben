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

interface NeighborChapter {
  id: number
  title: string
  page_count: number
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
  panel,
  onPanelChange
}: ReaderChromeProps) {
  const {
    mode,
    fit,
    rtl,
    rotate,
    page,
    pageCount,
    widePages,
    immersive,
    showThumbs,
    setPage,
    patch,
    toggleThumbs
  } = useReaderStore()

  const spread = spreadPages(page, pageCount, rtl, widePages)
  const lo = Math.min(...spread) + 1
  const hi = Math.max(...spread) + 1
  const currentDisplay =
    mode === 'webtoon' || lo === hi
      ? `${page + 1} / ${pageCount}`
      : `${lo}-${hi} / ${pageCount}`
  // 与 ReaderPage.goNext 的边界判定共用同一函数：末页卡片出现的时机 = 翻页会进下一话的时机
  const atEnd = atLastScreen(page, pageCount, mode, widePages)

  return (
    <>
      {/* 顶栏 */}
      <div
        className={cn(
          'absolute inset-x-0 top-0 z-20 flex h-12 items-center gap-2 px-4 transition-opacity duration-300',
          'bg-gradient-to-b from-black/80 to-black/0 text-white',
          immersive ? 'pointer-events-none opacity-0' : 'opacity-100'
        )}
      >
        <button
          onClick={onBack}
          className="grid size-8 place-items-center rounded-md hover:bg-white/10"
          title="返回 (Esc)"
        >
          <ArrowLeft className="size-4" />
        </button>
        {/* 跨话导航：直接跳前后话，与翻页无关 */}
        <button
          onClick={onPrevChapter}
          disabled={!neighbors?.prev}
          className="grid size-8 place-items-center rounded-md hover:bg-white/10 disabled:opacity-25"
          title={neighbors?.prev ? `上一话：${neighbors.prev.title}` : '没有上一话'}
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          onClick={onNextChapter}
          disabled={!neighbors?.next}
          className="grid size-8 place-items-center rounded-md hover:bg-white/10 disabled:opacity-25"
          title={neighbors?.next ? `下一话：${neighbors.next.title}` : '没有下一话'}
        >
          <ChevronRight className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {seriesTitle}
            <span className="mx-2 text-white/40">/</span>
            <span className="text-white/70">{chapterTitle}</span>
          </p>
        </div>
        <PageJump
          display={currentDisplay}
          page={page}
          onJump={(page0) => onJump(chapterId, page0)}
        />
        <div className="mx-1 h-5 w-px bg-white/20" />
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
      </div>

      {/* 模式切换（左下悬浮） */}
      <div
        className={cn(
          'absolute bottom-4 left-4 z-20 flex gap-1 rounded-lg bg-black/60 p-1 backdrop-blur transition-opacity duration-300',
          immersive ? 'pointer-events-none opacity-0' : 'opacity-100'
        )}
      >
        {MODES.map((m) => (
          <button
            key={m.key}
            onClick={() => onModeChange(m.key)}
            title={`${m.label}模式（M 循环切换）`}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs',
              mode === m.key ? 'bg-white/90 text-black' : 'text-white/80 hover:bg-white/10'
            )}
          >
            <m.icon className="size-3.5" />
            {m.label}
          </button>
        ))}
      </div>

      {/* 末页提示卡：直接进下一话（键盘/点击继续翻页也会自动进入） */}
      {atEnd && neighbors?.next && (
        <button
          onClick={onNextChapter}
          className={cn(
            'absolute bottom-8 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-xl px-5 py-3 text-sm shadow-2xl transition-all',
            'border border-white/10 bg-black/70 text-white backdrop-blur hover:bg-black/85'
          )}
        >
          <span className="text-white/60">本话完</span>
          <span className="max-w-56 truncate">下一话：{neighbors.next.title}</span>
          <ChevronRight className="size-4" />
        </button>
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

      {/* 缩略图条 */}
      {showThumbs && canThumbnail && (
        <div
          className={cn(
            'absolute inset-x-0 bottom-0 z-20 flex h-28 items-center gap-2 overflow-x-auto px-4 pb-3',
            'bg-gradient-to-t from-black/90 to-black/30 backdrop-blur transition-opacity',
            immersive ? 'pointer-events-none opacity-0' : 'opacity-100'
          )}
        >
          {Array.from({ length: pageCount }, (_, p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={cn(
                'relative h-20 shrink-0 overflow-hidden rounded border-2 transition-all',
                p === page ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100'
              )}
              title={`第 ${p + 1} 页`}
            >
              <img src={pageThumbUrl(chapterId, p)} alt="" className="h-full w-auto" loading="lazy" />
              <span className="absolute bottom-0 right-0 bg-black/60 px-1 text-[10px] text-white">
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

      {/* 快捷键帮助 */}
      {panel === 'help' && (
        <Panel title="快捷键" onClose={() => onPanelChange('none')}>
          <div className="grid gap-x-6 gap-y-2 px-4 py-3 text-xs sm:grid-cols-2">
            {SHORTCUTS.map(([keys, desc]) => (
              <div key={keys} className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{desc}</span>
                <kbd className="shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                  {keys}
                </kbd>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </>
  )
}

const SHORTCUTS: Array<[string, string]> = [
  ['← → / 空格', '翻页（末页自动进下一话）'],
  ['Home / End', '第一页 / 最后一页'],
  ['点击左右 1/3', '上一页 / 下一页'],
  ['Ctrl + 滚轮', '缩放'],
  ['M', '单页 / 双页 / 条漫'],
  ['D', '日漫 / 西漫方向'],
  ['S', '适宽 / 适高 / 原始'],
  ['R', '旋转 90°'],
  ['T', '缩略图条'],
  ['B', '收藏 / 取消当前页书签'],
  ['F', '全屏'],
  ['Esc', '退出全屏 / 返回'],
  ['?', '快捷键帮助']
]

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
        className="shrink-0 rounded px-1.5 py-1 text-xs text-white/70 tabular-nums hover:bg-white/10 hover:text-white"
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
      className="w-16 shrink-0 rounded border border-white/30 bg-black/60 px-1.5 py-1 text-center text-xs text-white tabular-nums outline-none"
    />
  )
}

function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="absolute right-4 top-14 z-30 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border bg-background shadow-2xl">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <button
          onClick={onClose}
          className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
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
        'grid size-8 place-items-center rounded-md text-white/85 hover:bg-white/10 [&_svg]:size-4',
        active && 'bg-white/20 text-white'
      )}
    >
      {children}
    </button>
  )
}
