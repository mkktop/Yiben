import { useEffect, useMemo, useState } from 'react'
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
  FolderInput,
  Loader2,
  Pencil,
  PlayCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { useAsync } from '@/hooks/useAsync'
import { useDataStore } from '@/stores/data'
import { CoverImage } from '@/components/library/CoverImage'
import { SeriesMaintenance } from '@/components/SeriesMaintenance'
import { EmptyHint } from '@/components/library/CoverGrid'
import type {
  ChapterWithProgress,
  PrefetchDone,
  PrefetchProgress,
  Series,
  SeriesDetail,
  ShelfInfo,
  OfflineStatus
} from '@shared/types'
import { parseTags } from '@shared/types'
import { cn, errorMessage } from '@/lib/utils'
import { createOrderedValue } from '@/lib/orderedInteraction'
import { seriesReading } from '@/lib/seriesReading'

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
  const groups: Array<{
    volume: string | null
    items: Array<{ c: ChapterWithProgress; i: number }>
  }> = []
  chapters.forEach((c, i) => {
    const last = groups[groups.length - 1]
    if (last && last.volume === c.volume) last.items.push({ c, i })
    else groups.push({ volume: c.volume, items: [{ c, i }] })
  })
  return groups
}

/** 手动编辑元数据：保存后打 meta_edited 标记，重扫不会覆盖 */
function MetaDialog({ series, onClose }: { series: Series; onClose: () => void }) {
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
      await window.yudu.series.updateMeta(series.id, {
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
    <Dialog
      title="编辑信息"
      onClose={onClose}
      closeDisabled={busy}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-4 p-5">
        <Field label="书名">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="作者">
          <Input value={author} onChange={(e) => setAuthor(e.target.value)} />
        </Field>
        <Field label="状态">
          <Input
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="连载中 / 已完结…"
          />
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
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </Dialog>
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

/**
 * 「书架与标签」弹层：虚拟书架多选（可新建）+ 自定义标签（回车创建、× 删除）。
 * 每次改动立即写库并 bump()，让书架/详情页的列表与角标跟着刷新。
 * 注意：这里的标签是与 ComicInfo 元数据无关的另一套（关联表存储）。
 */
function ShelfTagDialog({ series, onClose }: { series: Series; onClose: () => void }) {
  const version = useDataStore((s) => s.version)
  const bump = useDataStore((s) => s.bump)
  const [newShelf, setNewShelf] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(0)
  const [savedShelfIds, setSavedShelfIds] = useState<number[] | null>(null)
  const [savedTags, setSavedTags] = useState<string[] | null>(null)
  // 归属初值只在打开时拉取；后续由顺序写入更新，避免刷新中的旧快照覆盖新操作。
  const { data: shelves } = useAsync<ShelfInfo[]>(() => window.yudu.shelves.list(), [version])
  const { data: memberIds, error: shelfError } = useAsync<number[]>(
    () => window.yudu.shelves.forSeries(series.id),
    [series.id]
  )
  const { data: memberTags, error: tagError } = useAsync<string[]>(
    () => window.yudu.tags.forSeries(series.id),
    [series.id]
  )
  const shelfWrites = useMemo(() => memberIds && createOrderedValue(memberIds), [memberIds])
  const tagWrites = useMemo(() => memberTags && createOrderedValue(memberTags), [memberTags])

  const member = new Set(savedShelfIds ?? memberIds ?? [])
  const tags = savedTags ?? memberTags ?? []
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setPending((count) => count + 1)
    setError('')
    try {
      await fn()
      bump()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setPending((count) => count - 1)
    }
  }

  const toggleShelf = (id: number): void => {
    if (!shelfWrites) return
    void run(async () => {
      const next = await shelfWrites.update(
        (ids) => ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id],
        (ids) => window.yudu.shelves.setForSeries(series.id, ids)
      )
      setSavedShelfIds(next)
    })
  }

  const createShelfAndJoin = (): void => {
    const name = newShelf.trim()
    if (!name || !shelfWrites) return
    void run(async () => {
      const shelf = await window.yudu.shelves.create(name)
      const next = await shelfWrites.update(
        (ids) => [...new Set([...ids, shelf.id])],
        (ids) => window.yudu.shelves.setForSeries(series.id, ids)
      )
      setSavedShelfIds(next)
      setNewShelf((current) => current.trim() === name ? '' : current)
    })
  }

  const addTag = (): void => {
    const name = tagInput.trim()
    if (!name || !tagWrites) return
    void run(async () => {
      const next = await tagWrites.update(
        (entries) => [...new Set([...entries, name])],
        (entries) => window.yudu.tags.setForSeries(series.id, entries)
      )
      setSavedTags(next)
      setTagInput((current) => current.trim() === name ? '' : current)
    })
  }

  const removeTag = (name: string): void => {
    if (!tagWrites) return
    void run(async () => {
      const next = await tagWrites.update(
        (entries) => entries.filter((tag) => tag !== name),
        (entries) => window.yudu.tags.setForSeries(series.id, entries)
      )
      setSavedTags(next)
    })
  }

  return (
    <Dialog
      title="书架与标签"
      onClose={onClose}
      closeDisabled={pending > 0}
      footer={
        <Button size="sm" variant="outline" onClick={onClose} disabled={pending > 0}>
          完成
        </Button>
      }
    >
      <div className="max-h-[60vh] space-y-5 overflow-y-auto p-5">
        <section>
          <p className="mb-2 text-xs text-muted-foreground">虚拟书架（可归入多个）</p>
          <div className="flex flex-wrap gap-2">
            {(shelves ?? []).map((s) => (
              <button
                key={s.id}
                onClick={() => toggleShelf(s.id)}
                disabled={!shelfWrites}
                className={cn(
                  'flex items-center gap-1 rounded-full px-3 py-1.5 text-xs transition-colors',
                  member.has(s.id)
                    ? 'bg-primary font-medium text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                )}
              >
                {member.has(s.id) && <CheckCircle2 className="size-3" />}
                {s.name}
              </button>
            ))}
            {(shelves ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground">还没有书架，在下面创建一个</p>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <Input
              value={newShelf}
              onChange={(e) => setNewShelf(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createShelfAndJoin()}
              placeholder="新建书架，如「追更中」"
              className="h-8 text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8 shrink-0 px-2.5"
              disabled={!newShelf.trim() || !shelfWrites}
              onClick={createShelfAndJoin}
            >
              <Plus className="size-3.5" />
              新建并归入
            </Button>
          </div>
        </section>

        <section>
          <p className="mb-2 text-xs text-muted-foreground">
            自定义标签（与 ComicInfo 元数据标签相互独立）
          </p>
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <span
                key={t}
                className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary"
              >
                {t}
                <button
                  onClick={() => removeTag(t)}
                  className="grid size-4 place-items-center rounded-full hover:bg-primary/20"
                  title="删除标签"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            {tags.length === 0 && (
              <p className="text-xs text-muted-foreground">还没有标签</p>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTag()}
              placeholder="输入标签，回车添加"
              className="h-8 text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8 shrink-0 px-2.5"
              disabled={!tagInput.trim() || !tagWrites}
              onClick={addTag}
            >
              <Plus className="size-3.5" />
              添加
            </Button>
          </div>
        </section>

        {pending > 0 && <p role="status" className="text-xs text-muted-foreground">正在保存更改…</p>}
        {(error || shelfError || tagError) && <p className="text-xs text-destructive">{error || shelfError || tagError}</p>}
      </div>
    </Dialog>
  )
}

/** 整系列离线缓存（仅云端系列）：章节级进度条 + 取消 */
function PrefetchButton({
  seriesId,
  total,
  className
}: {
  seriesId: number
  total: number
  /** 深色横幅上调用时传白色系覆盖样式 */
  className?: string
}) {
  const [progress, setProgress] = useState<PrefetchProgress | null>(null)
  const [offline, setOffline] = useState<OfflineStatus | null>(null)
  const [error, setError] = useState('')

  // 挂载时对账：若预取已在别的页面启动，进度条照样显示
  useEffect(() => {
    void window.yudu.offline
      .status(seriesId)
      .then(setOffline)
      .catch((error) => setError(errorMessage(error)))
    void window.yudu.cloud
      .prefetchRunning()
      .then((running) => {
        if (running.includes(seriesId)) {
          setProgress({ seriesId, done: 0, total, chapterTitle: '' })
        }
      })
      .catch(() => {})
  }, [seriesId, total])

  useEffect(() => {
    const offProgress = window.yudu.events.onPrefetchProgress((p) => {
      if (p.seriesId === seriesId) setProgress(p)
    })
    const offDone = window.yudu.events.onPrefetchDone((p: PrefetchDone) => {
      if (p.seriesId !== seriesId) return
      setProgress(null)
      if (p.offline) setOffline(p.offline)
      if (p.error) setError(p.error)
      else if (p.failed?.length || (p.offline && p.offline.complete < p.offline.total))
        setError(`部分内容未缓存：${(p.offline?.missing ?? p.failed ?? []).join('、')}`)
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
        className={className}
        onClick={() => void window.yudu.cloud.prefetchCancel(seriesId)}
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
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        className={className}
        title={error || '把整部漫画提前下载到本地，断网也能看'}
        onClick={() => {
          setError('')
          void window.yudu.cloud.prefetch(seriesId).catch((e) => setError(errorMessage(e)))
        }}
      >
        <CloudDownload />
        {offline && offline.total > 0 && offline.complete === offline.total
          ? '已全部离线'
          : offline
            ? `离线缓存 ${offline.complete}/${offline.total}`
            : '离线缓存'}
      </Button>
      {offline?.pinned && (
        <Button
          size="sm"
          variant="outline"
          className={className}
          onClick={() =>
            void window.yudu.offline
              .pin(seriesId, false)
              .then(setOffline)
              .catch((error) => setError(errorMessage(error)))
          }
        >
          解除保护
        </Button>
      )}
      {error && <p className="max-w-md text-xs text-destructive">{error}</p>}
    </div>
  )
}

export function SeriesPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const version = useDataStore((s) => s.version)
  const bump = useDataStore((s) => s.bump)
  const { data, error } = useAsync(() => window.yudu.series.get(Number(id)), [id, version])
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removeError, setRemoveError] = useState('')
  const [actionError, setActionError] = useState('')
  const [editing, setEditing] = useState(false)
  const [organizing, setOrganizing] = useState(false)
  const [rescanning, setRescanning] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetting, setResetting] = useState(false)

  // 归属信息（弹层里改完 bump 后这里跟着刷新）；放在提前 return 之前保证 hooks 顺序
  const seriesId = Number(id) || 0
  const { data: myShelfIds } = useAsync<number[]>(
    () => window.yudu.shelves.forSeries(seriesId),
    [seriesId, version]
  )
  const { data: myTags } = useAsync<string[]>(
    () => window.yudu.tags.forSeries(seriesId),
    [seriesId, version]
  )

  if (error) {
    return <EmptyHint>加载失败：{error}</EmptyHint>
  }

  if (!id || data === undefined) {
    return <EmptyHint>加载中…</EmptyHint>
  }

  if (data === null) {
    return (
      <EmptyHint
        hint="这个系列可能已随书库删除，请返回书架查看。"
        action={{ label: '返回书架', onClick: () => navigate('/library') }}
      >
        系列不存在
      </EmptyHint>
    )
  }

  const detail = data as SeriesDetail
  const { series, chapters } = detail
  const tags = parseTags(series.tags)

  const totalChapters = chapters.length
  const readChapters = chapters.filter((c) => c.completed === 1).length
  const { chapter: nextChapter, started } = seriesReading(chapters)
  const isCloud = detail.libraryKind !== 'local'

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
      await window.yudu.series.remove(series.id)
      bump()
      navigate('/library')
    } catch (e) {
      setRemoveError(errorMessage(e))
    }
  }

  const rescanSeries = async (): Promise<void> => {
    setRescanning(true)
    await run(() => window.yudu.series.rescan(series.id))
    setRescanning(false)
  }

  const resetProgress = async (): Promise<void> => {
    setResetting(true)
    setActionError('')
    try {
      await window.yudu.series.resetProgress(series.id)
      bump()
      setConfirmReset(false)
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="mx-auto min-w-0 max-w-[1400px] space-y-6 p-6 lg:p-8" data-series-page>
      <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="-ml-2 text-muted-foreground">
        <ArrowLeft />
        返回
      </Button>

      {/* 首屏优先展示作品和阅读动作，维护入口放到下方信息区域。 */}
      <section className="relative overflow-hidden rounded-2xl border border-border/70 bg-card p-6 shadow-sm" data-series-hero>
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden opacity-10">
          <CoverImage
            seriesId={series.id}
            title=""
            className="size-full scale-125 object-cover blur-3xl"
            fallback={<></>}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent to-card" />
        </div>
        <div className="relative flex items-start gap-6">
          <div className="w-36 shrink-0 sm:w-40">
            <CoverImage
              seriesId={series.id}
              title={series.title}
              loading="eager"
              className="aspect-[3/4] w-full rounded-xl object-cover shadow-lg ring-1 ring-foreground/10"
              fallback={
                <div className="grid aspect-[3/4] w-full place-items-center rounded-xl bg-muted">
                  <BookOpen className="size-8 text-muted-foreground/50" />
                </div>
              }
            />
          </div>
          <div className="min-w-0 flex-1 py-1">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>漫画系列</span>
              {series.status && (
                <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 font-medium text-primary">
                  {series.status}
                </span>
              )}
            </div>
            <h1 className="break-words font-serif text-2xl leading-tight font-semibold text-foreground lg:text-3xl">
              {series.title}
            </h1>
            <p className="mt-2 break-words text-sm text-muted-foreground">{series.author || '作者暂无信息'}</p>

            <div className="mt-5 max-w-sm" data-series-progress>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums text-muted-foreground">
                <span>已读 {readChapters} / {totalChapters} 话</span>
                <span>{totalChapters > 0 ? Math.round((readChapters / totalChapters) * 100) : 0}%</span>
              </div>
              <div
                role="progressbar"
                aria-label="系列阅读进度"
                aria-valuemin={0}
                aria-valuemax={totalChapters || 1}
                aria-valuenow={readChapters}
                aria-valuetext={'共 ' + totalChapters + ' 话，已读 ' + readChapters + ' 话'}
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div className="h-full rounded-full bg-primary" style={{ width: (totalChapters > 0 ? (readChapters / totalChapters) * 100 : 0) + '%' }} />
              </div>
            </div>

            {nextChapter && (
              <div className="mt-5 flex min-w-0 flex-wrap items-center gap-3">
                <Button className="h-10 px-5" onClick={() => navigate('/reader/' + nextChapter.id)} data-series-read>
                  {started ? <PlayCircle /> : <BookOpen />}
                  {started ? '继续阅读' : '开始阅读'}
                </Button>
                <span className="min-w-0 max-w-full truncate text-xs text-muted-foreground" title={nextChapter.title}>
                  {nextChapter.title}
                </span>
              </div>
            )}
          </div>
        </div>
      </section>

      {(removeError || actionError) && (
        <p role="status" className="break-words rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {removeError || actionError}
        </p>
      )}

      <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]" data-series-content>
        <Card className="min-w-0">
          <CardHeader
            title="章节列表"
            action={
              <span className="text-xs text-muted-foreground">
                共 {totalChapters} 话 · 已读 {readChapters}
              </span>
            }
          />
          <CardBody>
            {volumeGroups(chapters).map((g, gi) => (
              <div key={`${g.volume ?? '_'}-${gi}`} className="space-y-0.5">
                {g.volume !== null && (
                  <div className="rounded-md bg-muted/60 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                    第 {g.volume} 卷
                  </div>
                )}
                {g.items.map(({ c, i }) => {
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
                      onKeyDown={(e) => {
                        // 已读勾选按钮有独立动作，不能让它的回车冒泡成打开章节。
                        if (e.target !== e.currentTarget) return
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          navigate(`/reader/${c.id}`)
                        }
                      }}
                      className="flex w-full cursor-pointer items-center gap-4 rounded-lg px-3 py-3 text-left transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="w-10 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
                        {c.number ?? i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{c.title}</span>
                      {c.scan_error && c.kind !== 'pdf' ? (
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
                            <span className="text-[11px] tabular-nums text-muted-foreground">
                              {pct}%
                            </span>
                          </div>
                        ) : (
                          // 页数未知（PDF 尚未打开过）：精确到「第几页」比一个恒为 0% 的进度条有用
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            第 {(c.read_page ?? 0) + 1} 页
                          </span>
                        )
                      ) : (
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {c.kind === 'pdf' && c.page_count === 0 ? 'PDF' : `${c.page_count} 页`}
                        </span>
                      )}
                      {/* 已读勾选：点图标只改已读状态，不进入阅读器 */}
                      <button
                        className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground/50 hover:bg-accent hover:text-foreground"
                        title={done ? '标记为未读' : '标记为已读'}
                        onClick={(e) => {
                          e.stopPropagation()
                          void run(() => window.yudu.progress.setCompleted(c.id, !done))
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
              </div>
            ))}
          </CardBody>
        </Card>

        <aside className="min-w-0 space-y-5" aria-label="作品信息与管理">
          <Card>
            <CardHeader title="作品信息" />
            <CardBody className="space-y-4">
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  title="编辑书名/作者/标签/简介（重扫不会覆盖）"
                  onClick={() => setEditing(true)}
                >
                  <Pencil />
                  编辑信息
                </Button>
                <SeriesMaintenance series={series} local={!isCloud} entry="metadata" />
              </div>
              {(series.year || series.language) && (
                <dl className="grid grid-cols-2 gap-3 text-xs">
                  {series.year && <div><dt className="text-muted-foreground">年份</dt><dd className="mt-1">{series.year}</dd></div>}
                  {series.language && <div><dt className="text-muted-foreground">语言</dt><dd className="mt-1 break-words">{LANG_NAMES[series.language] ?? series.language}</dd></div>}
                </dl>
              )}
              {series.description ? (
                <p className="break-words whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{series.description}</p>
              ) : (
                <p className="text-xs text-muted-foreground">暂无简介，可通过编辑信息或在线元数据补充。</p>
              )}
              {tags.length > 0 && (
                <div>
                  <p className="mb-2 text-xs text-muted-foreground">作品标签</p>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => <span key={tag} className="max-w-full break-words rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{tag}</span>)}
                  </div>
                </div>
              )}
              <div className="space-y-3 border-t border-border/60 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">已归入 {myShelfIds?.length ?? 0} 个书架</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-muted-foreground"
                    title="归入虚拟书架、打自定义标签"
                    onClick={() => setOrganizing(true)}
                  >
                    <FolderInput />
                    书架与标签
                    {(myShelfIds?.length ?? 0) + (myTags?.length ?? 0) > 0 && (
                      <span className="text-xs text-muted-foreground">{(myShelfIds?.length ?? 0) + (myTags?.length ?? 0)}</span>
                    )}
                  </Button>
                </div>
                {(myTags?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {myTags!.map((tag) => <span key={tag} className="max-w-full break-words rounded-md bg-primary/10 px-2 py-1 text-xs text-primary">{tag}</span>)}
                  </div>
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="系列管理" />
            <CardBody className="space-y-4">
              <div className="flex flex-wrap gap-1.5">
                {!isCloud && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={rescanning}
                    title="重新扫描这一系列（目录有变动时用）"
                    onClick={() => void rescanSeries()}
                  >
                    <RefreshCw className={cn(rescanning && 'animate-spin')} />
                    重扫
                  </Button>
                )}
                <SeriesMaintenance series={series} local={!isCloud} entry="merge" />
                <Button
                  size="sm"
                  variant="outline"
                  title="把全部章节标记为已读"
                  onClick={() => void run(() => window.yudu.series.markRead(series.id, true))}
                >
                  <CheckCheck />
                  全部已读
                </Button>
              </div>
              {isCloud && <PrefetchButton seriesId={series.id} total={totalChapters} />}
              <div className="space-y-3 border-t border-border/60 pt-4">
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    title="清空这个系列的阅读进度"
                    onClick={() => setConfirmReset(true)}
                  >
                    <RotateCcw />
                    重置进度
                  </Button>
                  {!confirmRemove && (
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
                {confirmRemove && (
                  <div className="space-y-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                    <p className="text-xs leading-relaxed text-muted-foreground">移出后重扫不会恢复，进度保留</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="destructive" onClick={() => void removeFromShelf()}><Trash2 />确认移出</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>取消</Button>
                    </div>
                  </div>
                )}
                <p className="text-xs leading-relaxed text-muted-foreground">管理操作不修改漫画原文件。</p>
              </div>
            </CardBody>
          </Card>
        </aside>
      </div>

      {editing && <MetaDialog key={series.id} series={series} onClose={() => setEditing(false)} />}
      {organizing && <ShelfTagDialog key={series.id} series={series} onClose={() => setOrganizing(false)} />}
      {confirmReset && (
        <Dialog
          title="重置阅读进度"
          onClose={() => setConfirmReset(false)}
          closeDisabled={resetting}
          footer={<>
            <Button variant="ghost" size="sm" disabled={resetting} onClick={() => setConfirmReset(false)}>取消</Button>
            <Button variant="destructive" size="sm" disabled={resetting} onClick={() => void resetProgress()}>
              {resetting && <Loader2 className="animate-spin" />}
              确认重置进度
            </Button>
          </>}
        >
          <div className="space-y-3 p-5 text-sm">
            <p>将清空「{series.title}」全部 {totalChapters} 话的阅读页码和已读状态，无法直接撤销。</p>
            <p className="text-xs text-muted-foreground">书签、阅读统计及漫画文件保留。</p>
            {actionError && <p className="text-xs text-destructive">{actionError}</p>}
          </div>
        </Dialog>
      )}
    </div>
  )
}
