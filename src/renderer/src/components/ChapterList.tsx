import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ChevronDown, Circle, LocateFixed } from 'lucide-react'
import type { ChapterWithProgress } from '@shared/types'
import { chapterFraction, readingPageLabel } from '@shared/reading'
import { chapterGroups } from '@/lib/chapterList'
import { Button } from './ui/button'
import { Input } from './ui/input'

export function ChapterList({ chapters, currentId, onToggleCompleted }: {
  chapters: ChapterWithProgress[]
  currentId: number | null
  onToggleCompleted: (chapter: ChapterWithProgress) => void
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [locateTarget, setLocateTarget] = useState<{ id: number } | null>(null)
  const allGroups = useMemo(() => chapterGroups(chapters), [chapters])
  const groups = useMemo(() => chapterGroups(chapters, query), [chapters, query])
  const searching = query.trim().length > 0
  const namedGroups = allGroups.filter((group) => group.volume !== null)
  const matches = groups.reduce((sum, group) => sum + group.items.length, 0)

  useEffect(() => {
    if (!locateTarget) return
    const frame = requestAnimationFrame(() => {
      const target = document.querySelector<HTMLButtonElement>(`[data-chapter-id="${locateTarget.id}"] button[data-open-chapter]`)
      target?.scrollIntoView({ block: 'center' })
      target?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [locateTarget])

  const locate = (): void => {
    const group = allGroups.find((item) => item.items.some(({ chapter }) => chapter.id === currentId))
    if (!group || currentId === null) return
    setQuery('')
    setCollapsed((previous) => {
      const next = new Set(previous)
      next.delete(group.key)
      return next
    })
    setLocateTarget({ id: currentId })
  }

  return <div className="space-y-4" data-chapter-list>
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 bg-card py-2">
      <Input aria-label="搜索章节" placeholder="搜索话名、话号或卷号…" value={query}
        onChange={(event) => setQuery(event.target.value)} className="min-w-40 flex-1" />
      <Button size="sm" variant="outline" disabled={currentId === null} onClick={locate}>
        <LocateFixed />定位当前话
      </Button>
      {namedGroups.length > 0 && <>
        <Button size="sm" variant="ghost" disabled={searching || collapsed.size === 0} onClick={() => setCollapsed(new Set())}>展开全部</Button>
        <Button size="sm" variant="ghost" disabled={searching || namedGroups.every((group) => collapsed.has(group.key))}
          onClick={() => setCollapsed(new Set(namedGroups.map((group) => group.key)))}>折叠全部</Button>
      </>}
    </div>
    {searching && <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground" role="status">
      <span>找到 {matches} 话</span><Button size="sm" variant="ghost" onClick={() => setQuery('')}>清空搜索</Button>
    </div>}
    {groups.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">
      {chapters.length === 0 ? '暂无章节，可重新扫描书库。' : '没有匹配的章节，请换个关键词。'}
    </p>}
    {groups.map((group) => {
      const closed = !searching && collapsed.has(group.key)
      return <div key={group.key} className="space-y-0.5">
        {group.volume !== null && <button className="flex w-full items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-left text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring"
          aria-expanded={!closed} aria-controls={`chapters-${group.key}`} onClick={() => setCollapsed((previous) => {
            const next = new Set(previous)
            if (next.has(group.key)) next.delete(group.key)
            else next.add(group.key)
            return next
          })} disabled={searching}>
          <ChevronDown className={'size-3.5 transition-transform ' + (closed ? '-rotate-90' : '')} />
          第 {group.volume} 卷<span className="ml-auto text-muted-foreground">{group.items.length} 话</span>
        </button>}
        <div id={`chapters-${group.key}`} hidden={closed}>
          {!closed && group.items.map(({ chapter, index }) => {
            const done = chapter.completed === 1
            const reading = !done && chapter.read_page !== null
            const pct = Math.round(chapterFraction(chapter.read_page, chapter.page_count, done) * 100)
            return <div key={chapter.id} data-chapter-id={chapter.id} className="flex items-center gap-2 rounded-lg hover:bg-accent/60">
              <button data-open-chapter onClick={() => navigate(`/reader/${chapter.id}`)}
                aria-current={chapter.id === currentId ? 'step' : undefined}
                className="flex min-w-0 flex-1 items-center gap-4 rounded-lg px-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-ring">
                <span className="w-10 shrink-0 text-center text-xs tabular-nums text-muted-foreground">{chapter.number ?? index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm" title={chapter.title}>{chapter.title}</span>
                {chapter.scan_error && chapter.kind !== 'pdf' ? <span className="flex shrink-0 items-center gap-1 text-xs text-destructive" title={chapter.scan_error}>
                  <AlertTriangle className="size-3.5" />扫描失败
                </span> : done ? <span className="shrink-0 text-xs text-muted-foreground">已读完</span> : reading ?
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground" title={readingPageLabel(chapter.read_page, chapter.page_count)}>
                    {chapter.page_count > 0 ? `在读 ${pct}%` : readingPageLabel(chapter.read_page, chapter.page_count)}
                  </span> : <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {chapter.page_count > 0 ? `${chapter.page_count} 页` : '总页数待确认'}
                  </span>}
              </button>
              <button className="mr-3 grid size-7 shrink-0 place-items-center rounded text-muted-foreground/50 hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                title={done ? '标记为未读' : '标记为已读'} aria-label={`${chapter.title}：${done ? '标记为未读' : '标记为已读'}`}
                onClick={() => onToggleCompleted(chapter)}>
                {done ? <CheckCircle2 className="size-4 text-primary" /> : <Circle className="size-4" />}
              </button>
            </div>
          })}
        </div>
      </div>
    })}
  </div>
}
