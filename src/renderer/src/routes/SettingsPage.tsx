import { useCallback, useEffect, useState } from 'react'
import { HardDrive, Loader2, Save, Trash2 } from 'lucide-react'
import { useThemeStore } from '@/stores/theme'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(0, Math.round(bytes / 1024))} KB`
}

interface SeriesCache {
  seriesId: number
  title: string
  bytes: number
}

function CloudCacheSection() {
  const [capGb, setCapGb] = useState('20')
  const [capDirty, setCapDirty] = useState(false)
  const [capSaved, setCapSaved] = useState(false)
  const [stats, setStats] = useState<{ totalBytes: number; files: number } | null>(null)
  const [list, setList] = useState<SeriesCache[]>([])
  const [busy, setBusy] = useState(false)

  const refresh = useCallback((): void => {
    void window.yiben.cloud.cacheStats().then(setStats)
    void window.yiben.cloud.cacheBySeries().then(setList)
  }, [])

  useEffect(() => {
    void window.yiben.cloud.cacheConfigGet().then((mb) => setCapGb(String(mb / 1024)))
    refresh()
  }, [refresh])

  const saveCap = (): void => {
    const gb = Number.parseFloat(capGb)
    if (!Number.isFinite(gb) || gb <= 0) return
    setBusy(true)
    void window.yiben.cloud
      .cacheConfigSet(Math.round(gb * 1024))
      .then((mb) => {
        setCapGb(String(mb / 1024))
        setCapDirty(false)
        setCapSaved(true)
        setTimeout(() => setCapSaved(false), 2000)
      })
      .finally(() => setBusy(false))
  }

  const clearAll = (): void => {
    const size = stats?.totalBytes ?? 0
    if (size <= 0) return
    if (!window.confirm(`确定清除全部云端缓存（${fmtBytes(size)}）？\n封面与阅读进度不受影响。`)) return
    setBusy(true)
    void window.yiben.cloud
      .cacheClearAll()
      .then(() => refresh())
      .finally(() => setBusy(false))
  }

  const clearOne = (seriesId: number): void => {
    setBusy(true)
    void window.yiben.cloud
      .cacheClearSeries(seriesId)
      .then(() => refresh())
      .finally(() => setBusy(false))
  }

  return (
    <section>
      <h2 className="mb-4 text-sm font-medium text-muted-foreground">云端缓存</h2>
      <div className="space-y-5 rounded-xl border p-5">
        {/* 概览 + 上限 */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-primary/10">
              <HardDrive className="size-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">
                已缓存 {stats ? fmtBytes(stats.totalBytes) : '…'}
                {stats ? (
                  <span className="ml-1 text-xs text-muted-foreground">{stats.files} 个文件</span>
                ) : null}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                读过的漫画保存在本地，断网可看；超限自动清理最久未看的
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">上限</span>
            <Input
              type="number"
              min={1}
              max={200}
              step={1}
              value={capGb}
              onChange={(e) => {
                setCapGb(e.target.value)
                setCapDirty(true)
              }}
              onKeyDown={(e) => e.key === 'Enter' && saveCap()}
              className="h-8 w-20 text-right"
            />
            <span className="text-xs text-muted-foreground">GB</span>
            <Button size="sm" variant="outline" disabled={!capDirty || busy} onClick={saveCap}>
              {busy ? <Loader2 className="animate-spin" /> : <Save className="size-3.5" />}
              {capSaved ? '已保存' : '保存'}
            </Button>
          </div>
        </div>

        {stats && stats.totalBytes > 0 && (
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{
                width: `${Math.min(100, Math.round((stats.totalBytes / (Number(capGb) * 1024 ** 3)) * 100))}%`
              }}
            />
          </div>
        )}

        {/* 清理 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">清理缓存</p>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={busy || !stats || stats.totalBytes <= 0}
              onClick={clearAll}
            >
              <Trash2 className="size-3.5" />
              清除全部
            </Button>
          </div>

          {list.length === 0 ? (
            <p className="rounded-lg border px-3 py-4 text-center text-xs text-muted-foreground">
              暂无按漫画的缓存（阅读后才会产生）
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-lg border">
              {list.map((s) => (
                <div
                  key={s.seriesId}
                  className="flex items-center gap-3 border-b border-border/60 px-3 py-2.5 last:border-0"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">{s.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {fmtBytes(s.bytes)}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                    disabled={busy}
                    onClick={() => clearOne(s.seriesId)}
                  >
                    <Trash2 className="size-3" />
                    清除
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export function SettingsPage() {
  const { mode, setMode } = useThemeStore()

  return (
    <div className="mx-auto max-w-3xl space-y-10 p-8">
      <header>
        <h1 className="font-serif text-2xl font-semibold">设置</h1>
      </header>

      <section>
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">外观</h2>
        <div className="grid grid-cols-2 gap-4">
          {(['dark', 'light'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                'rounded-xl border-2 p-4 text-left transition-colors',
                mode === m ? 'border-primary bg-primary/5' : 'border-border hover:border-ring/50'
              )}
            >
              <div
                className={cn(
                  'mb-3 h-16 rounded-lg border',
                  m === 'dark' ? 'bg-zinc-900' : 'bg-orange-50'
                )}
              />
              <span className="text-sm font-medium">{m === 'dark' ? '深色 · 墨' : '浅色 · 纸'}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">强调色系统将在 M5 提供</p>
      </section>

      <CloudCacheSection />
    </div>
  )
}
