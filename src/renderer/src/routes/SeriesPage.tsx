import { Fragment, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  CheckCheck,
  Circle,
  CloudDownload,
  Download,
  Loader2,
  Pencil,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Trash2,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAsync } from '@/hooks/useAsync'
import { useDataStore } from '@/stores/data'
import { CoverImage } from '@/components/library/CoverImage'
import { EmptyHint } from '@/components/library/CoverGrid'
import type {
  ChapterWithProgress,
  PrefetchDone,
  PrefetchProgress,
  Series,
  SeriesDetail
} from '@shared/types'
import { parseTags } from '@shared/types'
import { cn, errorMessage } from '@/lib/utils'

/** LanguageISO 代码 → 展示名（仅常见几种，其余原样展示） */
const LANG_NAMES: Record<string, string> = {
  zh: '中文',
  ja: '日语',
  ko: '韩语',
  en: '英语'
}

/** 章节按卷号分组（相邻同卷聚合；volume 为空的章节不显示组头） */
function volumeGroups(chapters: ChapterWithProgress[]): Array<{
  volume: string | null
  items: Array<{ c: ChapterWithProgress; i: number }>
}> {
  const groups: Array<{ volume: string | null; items: Array<{ c: ChapterWithProgress; i: number }> }> =
    []
  chapters.forEach((c, i) => {
    const last = groups[groups.length - 1]
    if (last && last.volume === c.volume) last.items.push({ c, i })
    else groups.push({ volume: c.volume, items: [{ c, i }] })
  })
  return groups
}

/** 手动编辑元数据：保存后打 meta_edited 标记，重扫不会覆盖 */
function MetaDialog({
  series,
  onClose
}: {
  series: Series
  onClose: () => void
}) {
  const bump = useDataStore((s) => s.bump)
  const [title, setTitle] = useState(series.title)
  const [author, setAuthor] = useState(series.author ?? '')
  const [status, setStatus] = useState(series.status ?? '')
  const [tags, setTags] = useState(parseTags(series.tags).join(', '))
  const [description, setDescription] = useState(series.description ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const tagsList = tags
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean)
      await window.yiben.series.updateMeta(series.id, {
        title: title.trim() || series.title,
        author: author.trim() || null,
        status: status.trim() || null,
        tags: tagsList.length > 0 ? JSON.stringify(tagsList) : null,
        description: description.trim() || null
      })
      bump()
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border bg-background p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">编辑信息</h2>
          <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="space-y-3">
          <Field label="书名">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="作者">
            <Input value={author} onChange={(e) => setAuthor(e.target.value)} />
          </Field>
          <Field label="状态">
            <Input value={status} onChange={(e) => setStatus(e.target.value)} placeholder="连载中 / 已完结…" />
          </Field>
          <Field label="标签（逗号分隔）">
            <Input value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <Field label="简介">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </Field>
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

/** 整系列离线缓存（仅云端系列）：章节级进度条 + 取消 */
function PrefetchButton({ seriesId, total }: { seriesId: number; total: number }) {
  const [progress, setProgress] = useState<PrefetchProgress | null>(null)
  const [error, setError] = useState('')

  // 挂载时对账：若预取已在别的页面启动，进度条照样显示
  useEffect(() => {
    void window.yiben.cloud
      .prefetchRunning()
      .then((running) => {
        if (running.includes(seriesId)) {
          setProgress({ seriesId, done: 0, total, chapterTitle: '' })
        }
      })
      .catch(() => {})
  }, [seriesId, total])

  useEffect(() => {
    const offProgress = window.yiben.events.onPrefetchProgress((p) => {
      if (p.seriesId === seriesId) setProgress(p)
    })
    const offDone = window.yiben.events.onPrefetchDone((p: PrefetchDone) => {
      if (p.seriesId !== seriesId) return
      setProgress(null)
      if (p.error) setError(p.error)
    })
    return () => {
      offProgress()
      offDone()
    }
  }, [seriesId])

  if (progress) {
    const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => void window.yiben.cloud.prefetchCancel(seriesId)}
        title="点击取消"
      >
        <Download className="animate-pulse" />
        <span className="flex items-center gap-2">
          缓存中 {pct}%
          <span className="h-1 w-16 overflow-hidden rounded-full bg-muted">
            <span className="block h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </span>
        </span>
      </Button>
    )
  }

  return (
    <Button
      size="sm"
      variant="outline"
      title={error || '把整部漫画提前下载到本地，断网也能看'}
      onClick={() => {
        setError('')
        void window.yiben.cloud.prefetch(seriesId).catch((e) => setError(errorMessage(e)))
      }}
    >
      <CloudDownload />
      离线缓存
    </Button>
  )
}

export function SeriesPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const version = useDataStore((s) => s.version)
  const bump = useDataStore((s) => s.bump)
  const { data, error } = useAsync(() => window.yiben.series.get(Number(id)), [id, version])
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removeError, setRemoveError] = useState('')
  const [actionError, setActionError] = useState('')
  const [editing, setEditing] = useState(false)
  const [rescanning, setRescanning] = useState(false)

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
  const isCloud = detail.libraryKind === 'cloud189'

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setActionError('')
    try {
      await fn()
      bump()
    } catch (e) {
      setActionError(errorMessage(e))
    }
  }

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

  const rescanSeries = async (): Promise<void> => {
    setRescanning(true)
    await run(() => window.yiben.series.rescan(series.id))
    setRescanning(false)
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
          <div className="flex items-center gap-1.5">
            {(removeError || actionError) && (
              <span className="mr-1 text-xs text-destructive">{removeError || actionError}</span>
            )}
            <Button
              size="sm"
              variant="ghost"
              title="编辑书名/作者/标签/简介（重扫不会覆盖）"
              onClick={() => setEditing(true)}
            >
              <Pencil />
              编辑信息
            </Button>
            {!isCloud && (
              <Button
                size="sm"
                variant="ghost"
                disabled={rescanning}
                title="重新扫描这一系列（目录有变动时用）"
                onClick={() => void rescanSeries()}
              >
                <RefreshCw className={cn(rescanning && 'animate-spin')} />
                重扫
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              title="把全部章节标记为已读"
              onClick={() => void run(() => window.yiben.series.markRead(series.id, true))}
            >
              <CheckCheck />
              全部已读
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              title="清空这个系列的阅读进度"
              onClick={() => void run(() => window.yiben.series.resetProgress(series.id))}
            >
              <RotateCcw />
              重置进度
            </Button>
            {isCloud && <PrefetchButton seriesId={series.id} total={totalChapters} />}
            {confirmRemove ? (
              <>
                <span className="text-xs text-muted-foreground">
                  移出后重扫不会恢复，进度保留
                </span>
                <Button size="sm" variant="destructive" onClick={() => void removeFromShelf()}>
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
              {series.year ? ` · ${series.year}` : ''}
              {series.language ? ` · ${LANG_NAMES[series.language] ?? series.language}` : ''}
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
          {volumeGroups(chapters).map((g, gi) => (
            <Fragment key={`${g.volume ?? '_'}-${gi}`}>
              {g.volume !== null && (
                <div
                  className={cn(
                    'bg-muted/50 px-5 py-2 text-xs font-medium text-muted-foreground',
                    gi > 0 && 'border-t'
                  )}
                >
                  第 {g.volume} 卷
                </div>
              )}
              {g.items.map(({ c, i }, idx) => {
                const done = c.completed === 1
                const reading = !done && (c.read_page ?? 0) > 0
                const pct =
                  c.page_count > 0
                    ? Math.round((((c.read_page ?? 0) + 1) / c.page_count) * 100)
                    : 0
                return (
                  <div
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/reader/${c.id}`)}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/reader/${c.id}`)}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-accent',
                      // 组内首行由组头承担分隔；无组头的组之间用首行上边框
                      (idx > 0 || (!g.volume && i > 0)) && 'border-t'
                    )}
                  >
                    <span className="w-10 shrink-0 text-center text-xs text-muted-foreground">
                      {c.number ?? i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{c.title}</span>
                    {c.scan_error ? (
                      // 损坏的压缩包等：悬浮显示扫描失败原因，每轮扫描会自动重试
                      <span
                        className="flex shrink-0 items-center gap-1 text-xs text-destructive"
                        title={c.scan_error}
                      >
                        <AlertTriangle className="size-3.5" />
                        扫描失败
                      </span>
                    ) : done ? (
                      <span className="shrink-0 text-xs text-muted-foreground">已读完</span>
                    ) : reading ? (
                      c.page_count > 0 ? (
                        <div className="flex w-28 shrink-0 items-center gap-2">
                          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${pct}%` }}
                            />
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
                {/* 已读勾选：点图标只改已读状态，不进入阅读器 */}
                <button
                  className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground/50 hover:bg-accent hover:text-foreground"
                  title={done ? '标记为未读' : '标记为已读'}
                  onClick={(e) => {
                    e.stopPropagation()
                    void run(() => window.yiben.progress.setCompleted(c.id, !done))
                  }}
                >
                  {done ? (
                    <CheckCircle2 className="size-4 text-primary" />
                  ) : (
                    <Circle className="size-4" />
                  )}
                </button>
              </div>
              )
            })}
            </Fragment>
          ))}
        </div>
      </div>

      {editing && <MetaDialog series={series} onClose={() => setEditing(false)} />}
    </div>
  )
}

