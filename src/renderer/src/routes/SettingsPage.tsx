import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  CopyX,
  Download,
  HardDrive,
  HeartPulse,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  Upload
} from 'lucide-react'
import { useThemeStore } from '@/stores/theme'
import { useDataStore } from '@/stores/data'
import { useUpdateStore } from '@/stores/update'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { cn, errorMessage } from '@/lib/utils'
import type { DiagnoseReport, ReaderPrefs } from '@shared/types'

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

/** 开关行：标题 + 描述 + 右侧开关；整行 hover 反馈，开关本体带色彩过渡 */
function ToggleRow({
  title,
  desc,
  checked,
  onChange
}: {
  title: string
  desc: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="-mx-3 flex items-center justify-between gap-4 rounded-lg px-3 py-1.5 transition-colors hover:bg-accent/60">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors',
          checked ? 'bg-primary hover:bg-primary/85' : 'bg-muted hover:bg-foreground/15'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
            checked ? 'left-[22px]' : 'left-0.5'
          )}
        />
      </button>
    </div>
  )
}

/** 新书打开时的默认阅读方式（按系列记忆的偏好优先级更高） */
function ReaderDefaultsSection() {
  const [defaults, setDefaults] = useState<ReaderPrefs>({})
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void window.yiben.reader.getDefaults().then(setDefaults)
  }, [])

  const patch = (p: ReaderPrefs): void => {
    void window.yiben.reader.setDefaults(p).then((merged) => {
      setDefaults(merged)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    })
  }

  const mode = defaults.mode ?? 'single'
  const fit = defaults.fit ?? 'width'
  const rtl = defaults.rtl ?? true

  return (
    <Card>
      <CardHeader title="阅读" />
      <CardBody>
        <ChoiceRow
          label="翻页模式"
          options={[
            { key: 'single', label: '单页' },
            { key: 'double', label: '双页' },
            { key: 'webtoon', label: '条漫' }
          ]}
          value={mode}
          onChange={(v) => patch({ mode: v as ReaderPrefs['mode'] })}
        />
        <ChoiceRow
          label="页面适配"
          options={[
            { key: 'width', label: '适宽' },
            { key: 'height', label: '适高' },
            { key: 'original', label: '原始' }
          ]}
          value={fit}
          onChange={(v) => patch({ fit: v as ReaderPrefs['fit'] })}
        />
        <ToggleRow
          title="日漫方向（从右往左）"
          desc="双页模式按日漫习惯从右往左翻；西漫可关闭"
          checked={rtl}
          onChange={(v) => patch({ rtl: v })}
        />
        <p className="text-xs text-muted-foreground">
          只影响还没单独设置过的漫画；在阅读器里改过的设置按系列记忆并优先生效。
          {saved ? ' 已保存 ✓' : ''}
        </p>
      </CardBody>
    </Card>
  )
}

function ChoiceRow({
  label,
  options,
  value,
  onChange
}: {
  label: string
  options: Array<{ key: string; label: string }>
  value: string
  onChange: (key: string) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {options.map((o) => (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            className={cn(
              'rounded-md px-3 py-1 text-xs transition-colors',
              value === o.key
                ? 'bg-background font-medium shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** 通用开关：本地库自动重扫、启动恢复上次阅读 */
function GeneralSection() {
  const [autoRescan, setAutoRescan] = useState(true)
  const [resume, setResume] = useState(true)

  useEffect(() => {
    void window.yiben.config.get('autoRescan').then((v) => setAutoRescan(v !== false))
    void window.yiben.config.get('resumeOnLaunch').then((v) => setResume(v !== false))
  }, [])

  return (
    <Card>
      <CardHeader title="通用" />
      <CardBody>
        <ToggleRow
          title="书库文件变动自动重扫"
          desc="往本地书库文件夹里加/删漫画后自动增量更新书架（约 5 秒延迟）"
          checked={autoRescan}
          onChange={(v) => {
            setAutoRescan(v)
            void window.yiben.config.set('autoRescan', v).catch(() => {})
          }}
        />
        <ToggleRow
          title="启动时打开上次阅读"
          desc="打开一本 Yiben 后直接回到上次读到的位置"
          checked={resume}
          onChange={(v) => {
            setResume(v)
            void window.yiben.config.set('resumeOnLaunch', v).catch(() => {})
          }}
        />
      </CardBody>
    </Card>
  )
}

/** 阅读进度与书签的导出/导入（JSON，跨设备按目录路径对账） */
function DataSection() {
  const bump = useDataStore((s) => s.bump)
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)
  const [message, setMessage] = useState('')

  const doExport = (): void => {
    setBusy('export')
    setMessage('')
    void window.yiben.data
      .export()
      .then((r) => {
        if (r) setMessage(`已导出 ${r.series} 个系列（${r.progress} 条进度、${r.bookmarks} 个书签）`)
      })
      .catch((e) => setMessage(errorMessage(e)))
      .finally(() => setBusy(null))
  }

  const doImport = (): void => {
    setBusy('import')
    setMessage('')
    void window.yiben.data
      .import()
      .then((r) => {
        if (r) {
          setMessage(
            `导入完成：匹配 ${r.matched}/${r.series} 个系列，合入 ${r.progress} 条进度、${r.bookmarks} 个书签` +
              (r.skipped > 0 ? `；${r.skipped} 条因找不到对应漫画被跳过` : '')
          )
          bump()
        }
      })
      .catch((e) => setMessage(errorMessage(e)))
      .finally(() => setBusy(null))
  }

  return (
    <Card>
      <CardHeader title="数据" />
      <CardBody>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">备份阅读进度</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              导出全部进度与书签为 JSON；导入时按漫画目录路径对账，较新的进度才会覆盖
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={doExport}>
              {busy === 'export' ? <Loader2 className="animate-spin" /> : <Download />}
              导出
            </Button>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={doImport}>
              {busy === 'import' ? <Loader2 className="animate-spin" /> : <Upload />}
              导入
            </Button>
          </div>
        </div>
        {message && <p className="text-xs text-muted-foreground">{message}</p>}
      </CardBody>
    </Card>
  )
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
    <Card>
      <CardHeader title="云端缓存" />
      <CardBody>
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
      </CardBody>
    </Card>
  )
}

/** 应用更新：检查 -> 下载（进度）-> 立即重启。发布渠道 GitHub Releases（仅打包版） */
function UpdateSection() {
  const u = useUpdateStore()
  const [autoCheck, setAutoCheck] = useState(true)

  useEffect(() => {
    void window.yiben.config.get('autoCheckUpdate').then((v) => setAutoCheck(v !== false))
  }, [])

  // 仅 available 状态下 version 才有效——latest 时后端也回传版本号(=当前版)，不能据此显示下载按钮
  const canDownload = u.status === 'available' && !u.ready
  const msg = (() => {
    if (u.ready) return `新版本 v${u.ready} 已下载完成，点击「立即重启」生效`
    if (u.downloading) return '正在下载更新…（完成后可点击「立即重启」）'
    if (u.error) return u.status === 'error' ? `检查失败：${u.error}（请检查网络后重试）` : `下载失败：${u.error}`
    if (u.status === 'dev') return '开发模式不检查更新（打包版自动检查 GitHub Releases）'
    if (u.status === 'available')
      return `发现新版本 v${u.version}，点击「下载更新」获取（全量安装包）`
    if (u.status === 'latest') return `已是最新版本（v${u.current}）`
    return ''
  })()

  return (
    <Card>
      <CardHeader title="关于与更新" />
      <CardBody>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-primary/10">
              <RefreshCw className={cn('size-5 text-primary', u.checking && 'animate-spin')} />
            </div>
            <div>
              <p className="text-sm font-medium">
                一本 Yiben
                <span className="ml-2 text-xs text-muted-foreground">v{u.current || '…'}</span>
                {canDownload && (
                  <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
                    可更新 v{u.version}
                  </span>
                )}
                {u.ready && (
                  <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
                    v{u.ready} 已就绪
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                发布渠道 GitHub Releases，仅打包版支持在线升级
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={u.checking || u.downloading}
              onClick={() => void u.check()}
            >
              {u.checking ? <Loader2 className="animate-spin" /> : <RefreshCw className="size-3.5" />}
              检查更新
            </Button>
            {canDownload && (
              <Button size="sm" disabled={u.downloading} onClick={() => void u.download()}>
                {u.downloading ? <Loader2 className="animate-spin" /> : <Download className="size-3.5" />}
                下载更新 v{u.version}
              </Button>
            )}
            {u.ready && (
              <Button size="sm" onClick={u.install}>
                <RotateCcw className="size-3.5" />
                立即重启 v{u.ready}
              </Button>
            )}
          </div>
        </div>

        {u.downloading && (
          <div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.min(100, Math.max(0, u.percent))}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">正在下载更新… {u.percent}%</p>
          </div>
        )}

        {msg && <p className="text-xs text-muted-foreground">{msg}</p>}

        {canDownload && u.notes && (
          <details className="rounded-lg border px-3 py-2">
            <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground">
              更新内容
            </summary>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-muted-foreground">
              {u.notes}
            </pre>
          </details>
        )}

        <ToggleRow
          title="启动时自动检查更新"
          desc="有新版本时在侧边栏版本号旁提示，不会自动下载"
          checked={autoCheck}
          onChange={(v) => {
            setAutoCheck(v)
            void window.yiben.config.set('autoCheckUpdate', v).catch(() => {})
          }}
        />
      </CardBody>
    </Card>
  )
}

/** 体检结果的折叠列表项：标题带数量，点击展开明细 */
function DiagnoseList({
  label,
  count,
  children
}: {
  label: string
  count: number
  children: React.ReactNode
}) {
  return (
    <details className="group rounded-lg border border-border/60">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-xs transition-colors hover:bg-accent/50">
        <span className="flex items-center gap-1.5">
          {count > 0 && <AlertTriangle className="size-3.5 text-warning" />}
          {label}
        </span>
        <span className={count > 0 ? 'font-medium' : 'text-muted-foreground'}>{count} 项</span>
      </summary>
      <div className="space-y-1.5 border-t border-border/60 px-3 py-2.5">{children}</div>
    </details>
  )
}

/** 库体检：只读诊断四类问题；修复动作（重扫/移出书架）由用户逐项触发 */
function DiagnoseSection() {
  const bump = useDataStore((s) => s.bump)
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<DiagnoseReport | null>(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busySeries, setBusySeries] = useState<number | null>(null)

  const run = (): Promise<void> => {
    setRunning(true)
    setError('')
    return window.yiben.diagnose
      .run()
      .then(setReport)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setRunning(false))
  }

  /** 重扫问题系列后自动再体检一次，让结果保持新鲜 */
  const rescanSeries = async (seriesId: number): Promise<void> => {
    setActionError('')
    setBusySeries(seriesId)
    try {
      await window.yiben.series.rescan(seriesId)
      await run()
      bump()
    } catch (e) {
      setActionError(errorMessage(e))
    } finally {
      setBusySeries(null)
    }
  }

  /** 移出书架（隐藏，不删数据）：本地同步把该项从重复分组里摘掉 */
  const removeSeries = async (id: number): Promise<void> => {
    setActionError('')
    try {
      await window.yiben.series.remove(id)
      if (report) {
        setReport({
          ...report,
          duplicateSeries: report.duplicateSeries
            .map((g) => g.filter((i) => i.id !== id))
            .filter((g) => g.length > 1)
        })
      }
      bump()
    } catch (e) {
      setActionError(errorMessage(e))
    }
  }

  const issues =
    report &&
    report.brokenChapters.length +
      report.emptyChapters.length +
      report.duplicateSeries.length +
      (report.orphanThumbBytes > 0 ? 1 : 0)

  return (
    <Card>
      <CardHeader title="库体检" />
      <CardBody>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-primary/10">
              <HeartPulse className="size-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">检查书库健康状况</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                扫描失败的章节、零页空章节、疑似重复系列、孤儿缩略图。只读诊断，不会改动任何数据
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" className="shrink-0" disabled={running} onClick={() => void run()}>
            {running ? <Loader2 className="animate-spin" /> : <HeartPulse />}
            {running ? '体检中…' : '开始体检'}
          </Button>
        </div>

        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        {actionError && <p className="mt-3 text-xs text-destructive">{actionError}</p>}

        {report && (
          <div className="mt-4 space-y-2">
            {issues === 0 && (
              <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-xs text-primary">
                一切正常，没有发现任何问题。
              </p>
            )}

            <DiagnoseList label="损坏章节（扫描列页失败）" count={report.brokenChapters.length}>
              {report.brokenChapters.length === 0 && (
                <p className="text-xs text-muted-foreground">没有损坏的章节</p>
              )}
              {report.brokenChapters.map((c) => (
                <div key={c.id} className="flex items-center gap-3 py-1 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="truncate">
                      {c.seriesTitle} · {c.title}
                    </p>
                    <p className="truncate text-muted-foreground" title={c.reason}>
                      {c.reason}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 px-2 text-xs"
                    disabled={busySeries !== null}
                    onClick={() => void rescanSeries(c.seriesId)}
                  >
                    {busySeries === c.seriesId ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <RefreshCw className="size-3" />
                    )}
                    重新扫描该系列
                  </Button>
                </div>
              ))}
            </DiagnoseList>

            <DiagnoseList label="空章节（页数为 0）" count={report.emptyChapters.length}>
              {report.emptyChapters.length === 0 && <p className="text-xs text-muted-foreground">没有空章节</p>}
              {report.emptyChapters.map((c) => (
                <p key={c.id} className="truncate py-0.5 text-xs">
                  {c.seriesTitle} · {c.title}
                </p>
              ))}
            </DiagnoseList>

            <DiagnoseList label="疑似重复系列（标题一致）" count={report.duplicateSeries.length}>
              {report.duplicateSeries.length === 0 && (
                <p className="text-xs text-muted-foreground">没有发现重复系列</p>
              )}
              {report.duplicateSeries.map((group, gi) => (
                <div key={gi} className="rounded-lg border border-border/60 p-2.5">
                  <div className="space-y-1">
                    {group.map((item) => (
                      <div key={item.id} className="flex items-center gap-3 text-xs">
                        <CopyX className="size-3 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate">{item.title}</p>
                          <p className="truncate text-muted-foreground">{item.folderPath}</p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-destructive"
                          onClick={() => void removeSeries(item.id)}
                        >
                          <Trash2 className="size-3" />
                          移出书架
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </DiagnoseList>

            <DiagnoseList label="孤儿页缩略图（章节已删除）" count={report.orphanThumbBytes > 0 ? 1 : 0}>
              <p className="py-0.5 text-xs text-muted-foreground">
                占用 {fmtBytes(report.orphanThumbBytes)}。体检只做统计，不会自动删除；可在文件管理器
                中清理 thumbs/pages 下的同名目录，或等下次全库重扫后自然对齐。
              </p>
            </DiagnoseList>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

export function SettingsPage() {
  const { theme, setTheme } = useThemeStore()

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-8">
      <header>
        <h1 className="font-serif text-2xl font-semibold">设置</h1>
      </header>

      <Card>
        <CardHeader title="外观" />
        <CardBody className="space-y-6">
          <div>
            <p className="mb-3 text-sm font-medium">主题</p>
            <div className="grid grid-cols-2 gap-4">
              {(
                [
                  {
                    key: 'paper',
                    label: '纸墨书斋 · 浅色',
                    desc: '暖纸 · 朱砂 · 书房雅气',
                    // 预览色条与 index.css 令牌对应：朱砂 / 暖纸 / 墨字
                    swatches: ['oklch(0.55 0.19 32)', 'oklch(0.985 0.002 85)', 'oklch(0.245 0.008 60)']
                  },
                  {
                    key: 'comic',
                    label: '现代漫画 · 深色',
                    desc: '油墨 · 信号黄 · 网点纹理',
                    // 预览色条：信号黄 / 墨蓝黑 / 浅字
                    swatches: ['oklch(0.86 0.15 95)', 'oklch(0.17 0.025 265)', 'oklch(0.95 0.012 95)']
                  }
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTheme(t.key)}
                  className={cn(
                    'rounded-xl border-2 p-4 text-left transition-colors',
                    theme === t.key
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-ring/50'
                  )}
                >
                  <div className="mb-3 flex h-8 overflow-hidden rounded-lg border">
                    {t.swatches.map((c) => (
                      <span key={c} className="h-full flex-1" style={{ background: c }} />
                    ))}
                  </div>
                  <span className="text-sm font-medium">{t.label}</span>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </CardBody>
      </Card>

      <ReaderDefaultsSection />
      <GeneralSection />
      <CloudCacheSection />
      <DataSection />
      <DiagnoseSection />
      <UpdateSection />
    </div>
  )
}
