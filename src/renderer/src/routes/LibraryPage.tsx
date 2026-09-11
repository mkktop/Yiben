import { useRef, useState } from 'react'
import {
  FolderPlus,
  Library as LibraryIcon,
  ListChecks,
  RefreshCw,
  Trash2,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAsync } from '@/hooks/useAsync'
import { useDataStore } from '@/stores/data'
import { CoverGrid, EmptyHint } from '@/components/library/CoverGrid'
import { errorMessage } from '@/lib/utils'
import type { Series, SeriesFilter } from '@shared/types'

interface LibraryRow {
  id: number
  name: string
  kind: string
  path: string
}

const filters: Array<{ key: SeriesFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'unread', label: '未读' },
  { key: 'reading', label: '在读' },
  { key: 'read', label: '最近阅读' },
  { key: 'recent', label: '最近添加' }
]

/** 单次拉取上限；超出时明确提示，不再静默截断 */
const MAX_SERIES = 5000

function LibraryManager({
  libraries,
  onClose
}: {
  libraries: LibraryRow[]
  onClose: () => void
}) {
  const bump = useDataStore((s) => s.bump)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const remove = async (lib: LibraryRow): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await window.yiben.libraries.remove(lib.id)
      setConfirmId(null)
      bump()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-md rounded-xl border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-3.5">
          <h2 className="text-sm font-semibold">书库管理</h2>
          <Button variant="ghost" size="icon" className="size-7" onClick={onClose} disabled={busy}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="max-h-80 overflow-y-auto p-3">
          {libraries.map((lib) => (
            <div key={lib.id} className="rounded-lg px-2 py-2.5 hover:bg-accent/60">
              <div className="flex items-center gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
                  <LibraryIcon className="size-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{lib.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {lib.kind === 'cloud189' ? '天翼云盘' : '本地'} · {lib.path}
                  </p>
                </div>
                {confirmId === lib.id ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 px-2.5 text-xs"
                      disabled={busy}
                      onClick={() => void remove(lib)}
                    >
                      确认删除
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2.5 text-xs"
                      onClick={() => setConfirmId(null)}
                      disabled={busy}
                    >
                      取消
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmId(lib.id)}
                  >
                    <Trash2 className="size-3.5" />
                    删除
                  </Button>
                )}
              </div>
              {confirmId === lib.id && (
                <p className="mt-1.5 pl-12 text-xs text-destructive">
                  将从书架移除该库的全部漫画与阅读进度，{lib.kind === 'cloud189' && '云端缓存及'}
                  原文件不受影响。
                </p>
              )}
            </div>
          ))}
        </div>

        {error && <p className="px-5 pb-2 text-xs text-destructive">{error}</p>}

        <div className="flex justify-end border-t border-border/60 px-5 py-3">
          <Button size="sm" variant="outline" onClick={onClose}>
            完成
          </Button>
        </div>
      </div>
    </div>
  )
}

export function LibraryPage() {
  const version = useDataStore((s) => s.version)
  const bump = useDataStore((s) => s.bump)
  const query = useDataStore((s) => s.query)
  const [filter, setFilter] = useState<SeriesFilter>('all')
  const [scanning, setScanning] = useState(false)
  const [managing, setManaging] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [confirmBatch, setConfirmBatch] = useState(false)
  const [batchError, setBatchError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data: libraries } = useAsync<LibraryRow[]>(
    () => window.yiben.libraries.list(),
    [version]
  )
  const { data: series, error: seriesError } = useAsync<Series[]>(
    () =>
      window.yiben.series.list({
        query: query.trim() || undefined,
        filter,
        // 多取一条用来判断是否被截断
        limit: MAX_SERIES + 1
      }),
    [version, query, filter]
  )

  const truncated = (series?.length ?? 0) > MAX_SERIES
  const visible = series && truncated ? series.slice(0, MAX_SERIES) : series

  const toggleSelect = (id: number): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const exitSelectMode = (): void => {
    setSelectMode(false)
    setSelected(new Set())
    setConfirmBatch(false)
    setBatchError('')
  }

  const batchRemove = async (): Promise<void> => {
    setBatchError('')
    try {
      await window.yiben.series.removeMany([...selected])
      exitSelectMode()
      bump()
    } catch (e) {
      setBatchError(errorMessage(e))
    }
  }

  const addLibrary = async (): Promise<void> => {
    await window.yiben.libraries.add()
    // 扫描进行中，进度事件完成后会 bump version
  }

  const rescanAll = async (): Promise<void> => {
    setScanning(true)
    try {
      for (const lib of libraries ?? []) {
        // 单个库失败不中断其余库；失败原因由主进程 scan:notice 推给右下角浮标
        try {
          await window.yiben.libraries.rescan(lib.id)
        } catch {
          /* 已由 ScanIndicator 呈现 */
        }
      }
    } finally {
      setScanning(false)
    }
  }

  const hasLibraries = (libraries?.length ?? 0) > 0

  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto w-full max-w-[1400px] space-y-5 p-8 pb-4">
        <header className="flex items-center justify-between">
          <h1 className="font-serif text-2xl font-semibold">书架</h1>
          <div className="flex items-center gap-2.5">
            {selectMode ? (
              <>
                <span className="text-sm text-muted-foreground">已选 {selected.size} 部</span>
                {confirmBatch ? (
                  <>
                    <span className="text-xs text-muted-foreground">进度保留，重扫不恢复</span>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={selected.size === 0}
                      onClick={() => void batchRemove()}
                    >
                      <Trash2 />
                      确认移出
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmBatch(false)}>
                      取消
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    disabled={selected.size === 0}
                    onClick={() => setConfirmBatch(true)}
                  >
                    <Trash2 />
                    移出书架
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={exitSelectMode}>
                  <X />
                  退出管理
                </Button>
              </>
            ) : (
              <>
                {hasLibraries && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => setSelectMode(true)}>
                      <ListChecks />
                      批量管理
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setManaging(true)}>
                      <LibraryIcon />
                      书库管理
                    </Button>
                    <Button variant="outline" size="sm" onClick={rescanAll} disabled={scanning}>
                      <RefreshCw className={scanning ? 'animate-spin' : ''} />
                      重新扫描
                    </Button>
                  </>
                )}
                <Button size="sm" onClick={addLibrary}>
                  <FolderPlus />
                  添加本地书库
                </Button>
              </>
            )}
          </div>
        </header>

        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {filters.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={
                  filter === f.key
                    ? 'rounded-full bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground'
                    : 'rounded-full bg-muted px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground'
                }
              >
                {f.label}
              </button>
            ))}
          </div>
          {truncated ? (
            <span className="text-xs text-destructive">
              结果过多，仅显示前 {MAX_SERIES} 条，请用搜索缩小范围
            </span>
          ) : query.trim() ? (
            <span className="text-xs text-muted-foreground">搜索“{query.trim()}”的结果</span>
          ) : null}
        </div>

        {batchError && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {batchError}
          </p>
        )}
        {seriesError && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            书架加载失败：{seriesError}
          </p>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 px-8 pb-8">
        {!hasLibraries ? (
          <EmptyHint>
            还没有书库。
            <button onClick={addLibrary} className="ml-1 text-primary underline underline-offset-2">
              添加本地文件夹
            </button>
            ，把漫画收进来（也可在左侧「网盘」添加云端目录）
          </EmptyHint>
        ) : (
          <CoverGrid
            series={visible}
            loading={!series && !seriesError}
            emptyHint="没有匹配的书目，换个关键词或筛选条件试试"
            selection={selectMode ? { selected, onToggle: toggleSelect } : null}
          />
        )}
      </div>

      {managing && libraries && (
        <LibraryManager libraries={libraries} onClose={() => setManaging(false)} />
      )}
    </div>
  )
}
