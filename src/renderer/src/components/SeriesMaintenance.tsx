import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'
import { useDataStore } from '@/stores/data'
import { errorMessage } from '@/lib/utils'
import type { MetadataCandidate, Series } from '@shared/types'
import { FileText, Merge } from 'lucide-react'

export function SeriesMaintenance({
  series,
  local,
  entry = 'all'
}: {
  series: Series
  local: boolean
  entry?: 'metadata' | 'merge' | 'all'
}) {
  const bump = useDataStore((s) => s.bump)
  const [panel, setPanel] = useState<'metadata' | 'merge' | null>(null)
  const [query, setQuery] = useState(series.title)
  const [results, setResults] = useState<MetadataCandidate[]>([])
  const [selected, setSelected] = useState<MetadataCandidate | null>(null)
  const [choices, setChoices] = useState<Series[]>([])
  const [sources, setSources] = useState<Series[]>([])
  const [source, setSource] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      await action()
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    if (panel !== 'merge') return
    let cancelled = false
    void Promise.all([
      window.yudu.series.list({ libraryId: series.library_id }),
      window.yudu.series.mergeSources(series.id)
    ])
      .then(([list, merged]: [Series[], Series[]]) => {
        if (!cancelled) {
          setChoices(list.filter((entry) => entry.id !== series.id))
          setSources(merged)
        }
      })
      .catch((error) => {
        if (!cancelled) setMessage(errorMessage(error))
      })
    return () => {
      cancelled = true
    }
  }, [panel, series.id, series.library_id])
  const close = (): void => {
    if (!busy) {
      setPanel(null)
      setMessage('')
      setSelected(null)
      setSource(null)
    }
  }
  return (
    <>
      {entry !== 'merge' && (
        <Button
          size="sm"
          variant="outline"
          title="搜索在线元数据或回写本地 ComicInfo"
          onClick={() => setPanel('metadata')}
        >
          <FileText />
          元数据
        </Button>
      )}
      {entry !== 'metadata' && (
        <Button
          size="sm"
          variant="outline"
          title="合并或解除同一书库的系列"
          onClick={() => setPanel('merge')}
        >
          <Merge />
          合并系列
        </Button>
      )}
      {panel && (
        <Dialog
          title={panel === 'metadata' ? '在线元数据与回写' : '合并系列'}
          onClose={close}
          closeDisabled={busy}
          className="max-w-xl"
        >
          <div className="max-h-[70vh] space-y-4 overflow-auto p-5 text-sm">
            {panel === 'metadata' ? (
              <>
                <p className="text-muted-foreground">
                  点击搜索后将标题发送至
                  AniList。先预览候选，再确认替换书名、作者、简介、状态和标签。
                </p>
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void run(async () => {
                      setSelected(null)
                      setResults(await window.yudu.metadata.search(query))
                    })
                  }}
                >
                  <Input
                    aria-label="元数据搜索标题"
                    value={query}
                    maxLength={200}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <Button type="submit" disabled={busy || !query.trim()}>
                    搜索
                  </Button>
                </form>
                <div className="space-y-2">
                  {results.map((item) => (
                    <button
                      key={item.id}
                      className={`w-full rounded-lg border p-3 text-left ${selected?.id === item.id ? 'border-primary bg-primary/10' : 'border-border'}`}
                      disabled={busy}
                      onClick={() => setSelected(item)}
                    >
                      <strong>{item.title}</strong>
                      <p className="text-xs text-muted-foreground">
                        {item.author || '作者未知'} · {item.status || '状态未知'}
                      </p>
                    </button>
                  ))}
                </div>
                {selected && (
                  <div className="space-y-3 rounded-lg bg-muted/40 p-3">
                    <p>{selected.description || '暂无简介'}</p>
                    <p className="text-xs text-muted-foreground">{selected.tags.join(' / ')}</p>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await window.yudu.metadata.apply(series.id, selected.id)
                          bump()
                          setMessage('已应用元数据，重扫不会覆盖')
                          setSelected(null)
                        })
                      }
                    >
                      确认应用候选信息
                    </Button>
                  </div>
                )}
                {local && (
                  <div className="space-y-2 border-t border-border pt-4">
                    <p className="text-muted-foreground">
                      将已保存的信息写入 ComicInfo.xml。ZIP
                      会在副本中更新并校验每页，原包另留备份；其他单文件格式写相邻元数据文件。
                    </p>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm('将当前已保存的元数据写入本地文件？会保留原文件备份。'))
                          void run(async () => {
                            const files = await window.yudu.metadata.write(series.id)
                            setMessage(`已写入 ${files.length} 个元数据文件 / 压缩包`)
                          })
                      }}
                    >
                      回写本地 ComicInfo
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="text-muted-foreground">
                  将同一书库的来源系列并入「{series.title}」展示。原文件、章节
                  ID、进度、书签均保留；重复章节保留，可随时解除合并。操作前自动备份数据库。
                </p>
                <label className="block space-y-2">
                  <span>选择来源系列</span>
                  <select
                    aria-label="来源系列"
                    className="w-full rounded-lg border border-border bg-card p-2"
                    disabled={busy}
                    value={source ?? ''}
                    onChange={(event) => setSource(Number(event.target.value) || null)}
                  >
                    <option value="">请选择</option>
                    {choices.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.title} · {entry.total_chapters ?? 0} 话
                      </option>
                    ))}
                  </select>
                </label>
                {source && (
                  <p className="break-all text-xs text-muted-foreground">
                    {choices.find((entry) => entry.id === source)?.folder_path}
                  </p>
                )}
                <Button
                  disabled={busy || !source}
                  onClick={() =>
                    void run(async () => {
                      const result = await window.yudu.series.merge(source!, series.id)
                      bump()
                      setMessage(`合并后共 ${result.chapters} 话`)
                      setSource(null)
                      setSources(await window.yudu.series.mergeSources(series.id))
                      setChoices((entries) => entries.filter((entry) => entry.id !== source))
                    })
                  }
                >
                  确认合并到当前系列
                </Button>
                {sources.length > 0 && (
                  <div className="space-y-2 border-t border-border pt-3">
                    <p>已合并的来源</p>
                    {sources.map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between gap-2">
                        <span>{entry.title}</span>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await window.yudu.series.unmerge(entry.id)
                              bump()
                              setSources((list) => list.filter((item) => item.id !== entry.id))
                              setChoices((list) => [...list, entry])
                              setMessage('已解除合并，原系列恢复展示')
                            })
                          }
                        >
                          解除合并
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {busy && (
              <p role="status" className="text-muted-foreground">
                正在处理，请稍候…
              </p>
            )}
            {message && (
              <p role="status" className="break-words text-sm">
                {message}
              </p>
            )}
          </div>
        </Dialog>
      )}
    </>
  )
}
