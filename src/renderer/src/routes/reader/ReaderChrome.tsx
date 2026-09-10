import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRightToLine,
  Columns2,
  GalleryVertical,
  Maximize,
  Minimize,
  RotateCw,
  Sheet,
  type LucideIcon
} from 'lucide-react'
import { useReaderStore, spreadPages, type ReaderMode } from '@/stores/reader'
import { pageThumbUrl } from '@shared/types'
import { cn } from '@/lib/utils'

interface ReaderChromeProps {
  chapterId: number
  seriesTitle: string
  chapterTitle: string
  /** PDF 没有逐页图片（pdfjs 直接渲染 canvas），缩略图条不可用 */
  canThumbnail: boolean
  isFullscreen: boolean
  toggleFullscreen: () => void
  onModeChange: (m: ReaderMode) => void
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
  onModeChange
}: ReaderChromeProps) {
  const navigate = useNavigate()
  const {
    mode,
    fit,
    rtl,
    rotate,
    page,
    pageCount,
    immersive,
    showThumbs,
    setPage,
    patch,
    toggleThumbs
  } = useReaderStore()

  const spread = spreadPages(page, pageCount, rtl)
  const lo = Math.min(...spread) + 1
  const hi = Math.max(...spread) + 1
  const currentDisplay =
    mode === 'webtoon' || lo === hi
      ? `${page + 1} / ${pageCount}`
      : `${lo}-${hi} / ${pageCount}`

  return (
    <>
      {/* 顶栏 */}
      <div
        className={cn(
          'absolute inset-x-0 top-0 z-20 flex h-12 items-center gap-3 px-4 transition-opacity duration-300',
          'bg-gradient-to-b from-black/80 to-black/0 text-white',
          immersive ? 'pointer-events-none opacity-0' : 'opacity-100'
        )}
      >
        <button
          onClick={() => navigate(-1)}
          className="grid size-8 place-items-center rounded-md hover:bg-white/10"
          title="返回 (Esc)"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {seriesTitle}
            <span className="mx-2 text-white/40">/</span>
            <span className="text-white/70">{chapterTitle}</span>
          </p>
        </div>
        <span className="shrink-0 text-xs text-white/70">{currentDisplay}</span>
        <div className="mx-1 h-5 w-px bg-white/20" />
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
            </button>
          ))}
        </div>
      )}
    </>
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
