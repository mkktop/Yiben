import { useEffect, useState } from 'react'
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
import { EmptyHint } from '@/components/library/CoverGrid'
import type {
  ChapterWithProgress,
  PrefetchDone,
  PrefetchProgress,
  Series,
  SeriesDetail,
  ShelfInfo
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
    <Dialog
      title="编辑信息"
      onClose={onClose}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
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
  // 都以 version 为依赖：写库 + bump 后自动重取，界面永远反映库里的真实状态
  const { data: shelves } = useAsync<ShelfInfo[]>(() => window.yiben.shelves.list(), [version])
  const { data: memberIds } = useAsync<number[]>(
    () => window.yiben.shelves.forSeries(series.id),
    [version, series.id]
  )
  const { data: memberTags } = useAsync<string[]>(
    () => window.yiben.tags.forSeries(series.id),
    [version, series.id]
  )

  const member = new Set(memberIds ?? [])
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setError('')
    try {
      await fn()
      bump()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const toggleShelf = (id: number): void => {
    const next = member.has(id) ? [...member].filter((x) => x !== id) : [...member, id]
    void run(() => window.yiben.shelves.setForSeries(series.id, next))
  }

  const createShelfAndJoin = (): void => {
    const name = newShelf.trim()
    if (!name) return
    void run(async () => {
      const shelf = await window.yiben.shelves.create(name)
      await window.yiben.shelves.setForSeries(series.id, [...member, shelf.id])
      setNewShelf('')
    })
  }

  const addTag = (): void => {
    const name = tagInput.trim()
    if (!name) return
    void run(async () => {
      await window.yiben.tags.setForSeries(series.id, [...(memberTags ?? []), name])
      setTagInput('')
    })
  }

  const removeTag = (name: string): void => {
    void run(() =>
      window.yiben.tags.setForSeries(
        series.id,
        (memberTags ?? []).filter((t) => t !== name)
      )
    )
  }

  return (
    <Dialog
      title="书架与标签"
      onClose={onClose}
      footer={
        <Button size="sm" variant="outline" onClick={onClose}>
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
                disabled={!newShelf.trim()}
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
              {(memberTags ?? []).map((t) => (
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
              {(memberTags ?? []).length === 0 && (
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
                disabled={!tagInput.trim()}
                onClick={addTag}
              >
                <Plus className="size-3.5" />
                添加
              </Button>
            </div>
          </section>

          {error && <p className="text-xs text-destructive">{error}</p>}
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
        className={className}
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
      className={className}
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
  const [organizing, setOrganizing] = useState(false)
  const [rescanning, setRescanning] = useState(false)

  // 归属信息（弹层里改完 bump 后这里跟着刷新）；放在提前 return 之前保证 hooks 顺序
  const seriesId = Number(id) || 0
  const { data: myShelfIds } = useAsync<number[]>(
    () => window.yiben.shelves.forSeries(seriesId),
    [seriesId, version]
  )
  const { data: myTags } = useAsync<string[]>(
    () => window.yiben.tags.forSeries(seriesId),
    [seriesId, version]
  )

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
      {/* 横幅背景：封面模糊放大 + 深色渐变遮罩（深浅主题都压暗，白字可读；
          遮罩在 68% 高度内保持较实，只在尾部快速过渡回页面背景 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] overflow-hidden">
        <CoverImage
          seriesId={series.id}
          title=""
          className="size-full scale-125 object-cover blur-3xl"
          fallback={<></>}
        />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.62),rgba(0,0,0,0.52)_68%,var(--background))]" />
      </div>

      <div className="relative mx-auto max-w-[1400px] p-8">
        <div className="mb-6 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(-1)}
            className="-ml-2 text-white/80 hover:bg-white/15 hover:text-white"
          >
            <ArrowLeft />
            返回
          </Button>
          <div className="flex items-center gap-1.5">
            {(removeError || actionError) && (
              <span className="mr-1 text-xs text-red-300">{removeError || actionError}</span>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-white/80 hover:bg-white/15 hover:text-white"
              title="编辑书名/作者/标签/简介（重扫不会覆盖）"
              onClick={() => setEditing(true)}
            >
              <Pencil />
              编辑信息
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-white/80 hover:bg-white/15 hover:text-white"
              title="归入虚拟书架、打自定义标签"
              onClick={() => setOrganizing(true)}
            >
              <FolderInput />
              书架与标签
              {(myShelfIds?.length ?? 0) + (myTags?.length ?? 0) > 0 && (
                <span className="text-xs text-white/50">
                  {(myShelfIds?.length ?? 0) + (myTags?.length ?? 0)}
                </span>
              )}
            </Button>
            {!isCloud && (
              <Button
                size="sm"
                variant="ghost"
                className="text-white/80 hover:bg-white/15 hover:text-white"
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
              className="text-white/80 hover:bg-white/15 hover:text-white"
              title="把全部章节标记为已读"
              onClick={() => void run(() => window.yiben.series.markRead(series.id, true))}
            >
              <CheckCheck />
              全部已读
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-white/60 hover:bg-white/15 hover:text-white"
              title="清空这个系列的阅读进度"
              onClick={() => void run(() => window.yiben.series.resetProgress(series.id))}
            >
              <RotateCcw />
              重置进度
            </Button>
            {isCloud && (
              <PrefetchButton
                seriesId={series.id}
                total={totalChapters}
                className="border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              />
            )}
            {confirmRemove ? (
              <>
                <span className="text-xs text-white/70">移出后重扫不会恢复，进度保留</span>
                <Button size="sm" variant="destructive" onClick={() => void removeFromShelf()}>
                  <Trash2 />
                  确认移出
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-white/80 hover:bg-white/15 hover:text-white"
                  onClick={() => setConfirmRemove(false)}
                >
                  取消
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="text-white/60 hover:bg-white/15 hover:text-white"
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
            className="w-44 shrink-0 rounded-xl object-cover shadow-lg ring-1 ring-white/20"
            fallback={
              <div className="grid aspect-[3/4] w-44 shrink-0 place-items-center rounded-xl bg-muted">
                <BookOpen className="size-8 text-muted-foreground/50" />
              </div>
            }
          />
          <div className="min-w-0 flex-1 pt-1">
            <h1 className="font-serif text-3xl font-semibold text-white">{series.title}</h1>
            {series.author && (
              <p className="mt-2 text-sm text-white/70">{series.author}</p>
            )}
            {tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-white/15 px-2.5 py-1 text-xs text-white/85"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
            {/* 自定义标签：与上面的元数据标签是两套体系，用主色区分显示 */}
            {(myTags?.length ?? 0) > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {myTags!.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-primary/25 px-2.5 py-1 text-xs text-primary"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
            <p className="mt-3 text-xs tabular-nums text-white/65">
              共 {totalChapters} 话 · 已读 {readChapters}
              {series.year ? ` · ${series.year}` : ''}
              {series.language ? ` · ${LANG_NAMES[series.language] ?? series.language}` : ''}
              {series.status ? ` · ${series.status}` : ''}
            </p>
            {nextChapter && (
              <Button className="mt-5 shadow-lg" onClick={() => navigate(`/reader/${nextChapter.id}`)}>
                {readChapters > 0 ? <PlayCircle /> : <BookOpen />}
                {readChapters > 0 ? '继续阅读' : '开始阅读'}
                {readChapters > 0 && nextChapter ? ` · ${nextChapter.title}` : ''}
              </Button>
            )}
          </div>
        </div>

        {series.description && (
          <p className="mt-6 max-w-3xl text-sm leading-relaxed text-white/75">
            {series.description}
          </p>
        )}

        <Card className="mt-8">
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
                      onKeyDown={(e) => e.key === 'Enter' && navigate(`/reader/${c.id}`)}
                      className="flex w-full cursor-pointer items-center gap-4 rounded-lg px-3 py-3 text-left transition-colors hover:bg-accent/60"
                    >
                      <span className="w-10 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
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
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      {editing && <MetaDialog series={series} onClose={() => setEditing(false)} />}
      {organizing && <ShelfTagDialog series={series} onClose={() => setOrganizing(false)} />}
    </div>
  )
}

