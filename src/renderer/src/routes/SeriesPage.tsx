import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, CheckCircle2, PlayCircle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAsync } from '@/hooks/useAsync'
import { useDataStore } from '@/stores/data'
import { CoverImage } from '@/components/library/CoverImage'
import { EmptyHint } from '@/components/library/CoverGrid'
import type { SeriesDetail } from '@shared/types'
import { parseTags } from '@shared/types'
import { cn, errorMessage } from '@/lib/utils'

export function SeriesPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const version = useDataStore((s) => s.version)
  const bump = useDataStore((s) => s.bump)
  const { data, error } = useAsync(() => window.yiben.series.get(Number(id)), [id, version])
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removeError, setRemoveError] = useState('')

  if (error) {
    return <EmptyHint>加载失败：{error}</EmptyHint>
  }

  if (!id || !data) {
    return <EmptyHint>加载中…</EmptyHint>
  }

  const detail = data as SeriesDetail
  const { series, chapters } = detail
  const tags = parseTags(series.tags)

  const totalChapters = chapters.length
  const readChapters = chapters.filter((c) => c.completed === 1).length
  const nextChapter =
    chapters.find((c) => c.completed !== 1) ?? chapters[chapters.length - 1] ?? null

  const removeFromShelf = async (): Promise<void> => {
    setRemoveError('')
    try {
      await window.yiben.series.remove(series.id)
      bump()
      navigate('/library')
    } catch (e) {
      setRemoveError(errorMessage(e))
    }
  }

  return (
    <div className="relative h-full">
      {/* 模糊封面背景 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 overflow-hidden">
        <CoverImage
          seriesId={series.id}
          title=""
          className="size-full scale-110 object-cover opacity-25 blur-2xl"
          fallback={<></>}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background" />
      </div>

      <div className="relative mx-auto max-w-[1200px] p-8">
        <div className="mb-6 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="-ml-2">
            <ArrowLeft />
            返回
          </Button>
          <div className="flex items-center gap-2">
            {removeError && <span className="text-xs text-destructive">{removeError}</span>}
            {confirmRemove ? (
              <>
                <span className="text-xs text-muted-foreground">
                  移出后重扫不会恢复，进度保留
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => void removeFromShelf()}
                >
                  <Trash2 />
                  确认移出
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
                  取消
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmRemove(true)}
              >
                <Trash2 />
                移出书架
              </Button>
            )}
          </div>
        </div>

        <div className="flex gap-7">
          <CoverImage
            seriesId={series.id}
            title={series.title}
            className="w-44 shrink-0 rounded-xl object-cover shadow-lg"
            fallback={
              <div className="grid aspect-[3/4] w-44 shrink-0 place-items-center rounded-xl bg-muted">
                <BookOpen className="size-8 text-muted-foreground/50" />
              </div>
            }
          />
          <div className="min-w-0 flex-1 pt-1">
            <h1 className="font-serif text-3xl font-semibold">{series.title}</h1>
            {series.author && (
              <p className="mt-2 text-sm text-muted-foreground">{series.author}</p>
            )}
            {tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              共 {totalChapters} 话 · 已读 {readChapters}
              {series.status ? ` · ${series.status}` : ''}
            </p>
            {nextChapter && (
              <Button className="mt-5" onClick={() => navigate(`/reader/${nextChapter.id}`)}>
                {readChapters > 0 ? <PlayCircle /> : <BookOpen />}
                {readChapters > 0 ? '继续阅读' : '开始阅读'}
                {readChapters > 0 && nextChapter ? ` · ${nextChapter.title}` : ''}
              </Button>
            )}
          </div>
        </div>

        {series.description && (
          <p className="mt-6 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {series.description}
          </p>
        )}

        <h2 className="mb-3 mt-8 text-sm font-medium text-muted-foreground">章节列表</h2>
        <div className="overflow-hidden rounded-xl border">
          {chapters.map((c, i) => {
            const done = c.completed === 1
            const reading = !done && (c.read_page ?? 0) > 0
            const pct = c.page_count > 0 ? Math.round((((c.read_page ?? 0) + 1) / c.page_count) * 100) : 0
            return (
              <button
                key={c.id}
                onClick={() => navigate(`/reader/${c.id}`)}
                className={cn(
                  'flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-accent',
                  i > 0 && 'border-t'
                )}
              >
                <span className="w-10 shrink-0 text-center text-xs text-muted-foreground">
                  {c.number ?? i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{c.title}</span>
                {done ? (
                  <CheckCircle2 className="size-4 shrink-0 text-primary" />
                ) : reading ? (
                  c.page_count > 0 ? (
                    <div className="flex w-28 shrink-0 items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] text-muted-foreground">{pct}%</span>
                    </div>
                  ) : (
                    // 页数未知（PDF 尚未打开过）：精确到「第几页」比一个恒为 0% 的进度条有用
                    <span className="shrink-0 text-xs text-muted-foreground">
                      第 {(c.read_page ?? 0) + 1} 页
                    </span>
                  )
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {c.kind === 'pdf' && c.page_count === 0 ? 'PDF' : `${c.page_count} 页`}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
