import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { ReaderAppearance } from '@/components/ReaderAppearance'
import { patchReaderPrefs, useReaderStore } from '@/stores/reader'
import { pageThumbUrl } from '@shared/types'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Eye, Grid2X2 } from 'lucide-react'
import { acceptReaderShortcut, readerShortcutTarget } from './readerInteractions'

export function ReaderTools({
  chapterId,
  seriesId,
  onJump,
  allowImages,
  blocked,
  onOpenChange
}: {
  chapterId: number
  seriesId: number
  onJump: (page: number) => void
  allowImages: boolean
  blocked: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [panel, setPanel] = useState<'none' | 'grid' | 'appearance'>('none')
  const prefs = useReaderStore()
  useEffect(() => {
    onOpenChange(panel !== 'none')
    return () => onOpenChange(false)
  }, [panel, onOpenChange])
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      // Esc 先关闭自己持有的弹窗，聚焦滑块 / 开关时也能退出。
      if (event.key === 'Escape' && panel !== 'none') {
        setPanel('none')
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
      if (!acceptReaderShortcut(event, readerShortcutTarget(event.target))) return
      if (blocked && panel === 'none') return
      if (panel === 'none' && document.querySelector('[role="dialog"][aria-modal="true"]')) return
      if (event.key === 'g' || event.key === 'G') {
        if (allowImages) setPanel((value) => (value === 'grid' ? 'none' : 'grid'))
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      if (event.key === 'e' || event.key === 'E') {
        if (allowImages) patchReaderPrefs(seriesId, { enhance: !useReaderStore.getState().enhance })
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [panel, seriesId, allowImages, blocked])
  return (
    <>
      {!prefs.immersive && !blocked && (
        <div className="absolute bottom-16 left-3 z-30 flex gap-1 rounded-xl border border-border/50 bg-background/80 p-1 text-foreground shadow-lg backdrop-blur-md">
          <button
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => setPanel('appearance')}
          >
            <Eye className="size-3.5" />
            护眼{allowImages ? '与增强' : ''}
          </button>
          {allowImages && (
            <button
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => setPanel('grid')}
            >
              <Grid2X2 className="size-3.5" />
              全览 <kbd className="rounded border border-border/60 px-1 text-[10px]">G</kbd>
            </button>
          )}
        </div>
      )}
      {panel === 'appearance' && (
        <Dialog title={allowImages ? '护眼与图像增强' : '护眼设置'} onClose={() => setPanel('none')}>
          <div className="p-5">
            <ReaderAppearance
              allowImages={allowImages}
              showShortcut
              prefs={prefs}
              onChange={(value) => patchReaderPrefs(seriesId, value)}
            />
          </div>
        </Dialog>
      )}
      {panel === 'grid' && (
        <Dialog
          title={`页面全览 · ${prefs.pageCount || '页数未知'}`}
          onClose={() => setPanel('none')}
          className="max-w-4xl"
        >
          <ThumbnailGrid
            chapterId={chapterId}
            count={prefs.pageCount}
            jump={(page) => {
              onJump(page)
              setPanel('none')
            }}
          />
        </Dialog>
      )}
    </>
  )
}
function ThumbnailGrid({
  chapterId,
  count,
  jump
}: {
  chapterId: number
  count: number
  jump: (page: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const virtual = useVirtualizer({
    count: Math.ceil(count / 4),
    getScrollElement: () => ref.current,
    estimateSize: () => 210,
    overscan: 2
  })
  return (
    <div ref={ref} className="h-[65vh] overflow-auto p-3">
      {count === 0 ? (
        <p>页数确认后可使用全览</p>
      ) : (
        <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
          {virtual.getVirtualItems().map((row) => (
            <div
              key={row.key}
              className="absolute inset-x-0 grid grid-cols-4 gap-3"
              style={{ transform: `translateY(${row.start}px)`, height: 200 }}
            >
              {Array.from({ length: 4 }, (_, column) => row.index * 4 + column)
                .filter((page) => page < count)
                .map((page) => (
                  <button
                    key={page}
                    onClick={() => jump(page)}
                    className="flex min-w-0 flex-col items-center gap-1 overflow-hidden"
                  >
                    <img
                      className="h-44 w-full object-contain"
                      src={pageThumbUrl(chapterId, page)}
                      loading="lazy"
                      alt={`第 ${page + 1} 页`}
                    />
                    <span className="text-xs">{page + 1}</span>
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
