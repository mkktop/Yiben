import { useCallback, useEffect, useRef, useState } from 'react'
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
import { useDataStore } from '@/stores/data'
import { useUpdateStore } from '@/stores/update'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { cn, errorMessage } from '@/lib/utils'
import type { DiagnoseReport, ReaderPrefs } from '@shared/types'
import { BackupSection } from '@/components/BackupSection'
import { ReaderAppearance } from '@/components/ReaderAppearance'
import { ThemeSettings } from '@/components/ThemeSettings'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

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
  disabled = false,
  onChange
}: {
  title: string
  desc: string
  checked: boolean
  disabled?: boolean
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
        aria-label={title}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50',
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
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const revision = useRef(0)

  useEffect(() => {
    void window.yudu.reader.getDefaults().then(setDefaults)
      .catch((cause) => setError(errorMessage(cause)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => setSaved(false), 1500)
    return () => clearTimeout(timer)
  }, [saved])

  const patch = (p: ReaderPrefs): void => {
    const request = ++revision.current
    setDefaults((current) => ({ ...current, ...p }))
    setSaved(false)
    setSaving(true)
    setError('')
    void window.yudu.reader.setDefaults(p).then((merged) => {
      if (request !== revision.current) return
      setDefaults(merged)
      setSaved(true)
    }).catch((cause) => {
      if (request !== revision.current) return
      setError(`保存失败：${errorMessage(cause)}`)
      void window.yudu.reader.getDefaults().then((current) => {
        if (request === revision.current) setDefaults(current)
      }).catch(() => {})
    }).finally(() => {
      if (request === revision.current) setSaving(false)
    })
  }

  const mode = defaults.mode ?? 'single'
  const fit = defaults.fit ?? 'height'
  const rtl = defaults.rtl ?? true

  return (
    <Card>
      <CardHeader title="阅读" />
      <CardBody>
        <fieldset disabled={loading} className="space-y-4 disabled:opacity-50">
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
        <ReaderAppearance prefs={defaults} onChange={patch} />
        </fieldset>
        <p className="text-xs text-muted-foreground">
          只影响还没单独设置过的漫画；在阅读器里改过的设置按系列记忆并优先生效。
          {loading ? ' 正在加载…' : saving ? ' 正在保存…' : saved ? ' 已保存 ✓' : ''}
        </p>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
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
      <div role="group" aria-label={label} className="flex gap-1 rounded-lg bg-muted p-1">
        {options.map((o) => (
          <button
            key={o.key}
            aria-pressed={value === o.key}
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
/** Electron 加速键展示格式：Control → Ctrl（与帮助面板一致） */
function formatAccelerator(a: string): string {
  return a.replace(/Control\+/g, 'Ctrl+')
}

const BOSS_MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'])

/** KeyboardEvent → Electron 加速键字符串。
 *  只按了修饰键返回 null（尚未按主键）；不合格返回 'INVALID'：
 *  裸字母/数字/空格会作为全局热键系统级劫持正常打字，必须包含 Ctrl 或 Alt；
 *  F 功能键本身够独特，允许裸按。 */
function eventToAccelerator(e: KeyboardEvent): string | null {
  if (BOSS_MODIFIER_KEYS.has(e.key)) return null
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Control')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  const key = e.key
  let main = ''
  if (/^[a-z]$/i.test(key)) main = key.toUpperCase()
  else if (/^[0-9]$/.test(key)) main = key
  else if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key)) main = key
  else if (key === ' ') main = 'Space'
  else if (key === 'Enter') main = 'Return'
  else if (key === 'Tab') main = 'Tab'
  else if (key === 'Backspace') main = 'Backspace'
  else if (key === 'Delete') main = 'Delete'
  else if (key === 'Insert') main = 'Insert'
  else if (key === 'Home') main = 'Home'
  else if (key === 'End') main = 'End'
  else if (key === 'PageUp') main = 'PageUp'
  else if (key === 'PageDown') main = 'PageDown'
  else if (key === 'ArrowUp') main = 'Up'
  else if (key === 'ArrowDown') main = 'Down'
  else if (key === 'ArrowLeft') main = 'Left'
  else if (key === 'ArrowRight') main = 'Right'
  else if (key.length === 1 && /^[-=[\];'`,.\\/]$/.test(key)) main = key
  if (!main) return 'INVALID'
  parts.push(main)
  if (!parts.some((p) => p === 'Control' || p === 'Alt') && !main.startsWith('F')) return 'INVALID'
  return parts.join('+')
}

/** 老板键录制器：点击进入录制态，按下组合键完成捕获，Esc 取消。
 *  录制逻辑在 GeneralSection 的 capture 按键监听里，这里只是展示态按钮 */

function GeneralSection() {
  const [autoRescan, setAutoRescan] = useState(true)
  const [resume, setResume] = useState(true)
  const [configLoading, setConfigLoading] = useState(true)
  const [configSaving, setConfigSaving] = useState(false)
  const [configError, setConfigError] = useState('')
  /** 用户设置的主键偏好（'' = 自动）；active 是实际注册成功的键 */
  const [bossPref, setBossPref] = useState('')
  const [bossActive, setBossActive] = useState('')
  const [bossHint, setBossHint] = useState('')
  const [recording, setRecording] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    void Promise.all([
      window.yudu.config.get('autoRescan').then((v) => setAutoRescan(v !== false)),
      window.yudu.config.get('resumeOnLaunch').then((v) => setResume(v !== false))
    ]).catch((cause) => setConfigError(errorMessage(cause))).finally(() => setConfigLoading(false))
    void window.yudu.config
      .get('bossKey')
      .then((v) => setBossPref(typeof v === 'string' ? v : ''))
      .catch(() => {})
    void window.yudu.bossKey
      .get()
      .then(setBossActive)
      .catch(() => {})
  }, [])

  const saveConfig = (key: string, value: boolean, previous: boolean, apply: (value: boolean) => void): void => {
    apply(value)
    setConfigSaving(true)
    setConfigError('')
    void window.yudu.config.set(key, value).catch((cause) => {
      apply(previous)
      setConfigError(`保存失败：${errorMessage(cause)}`)
    }).finally(() => setConfigSaving(false))
  }

  const applyBossKey = (requested: string): void => {
    setBossPref(requested)
    void window.yudu.bossKey
      .set(requested)
      .then((active) => {
        setBossActive(active)
        setBossHint(
          requested && active !== requested ? '该组合键已被其他程序占用，已回退到候选键' : ''
        )
      })
      .catch((e) => setBossHint(errorMessage(e)))
  }

  // 录制态的按键捕获：capture 阶段拦截（避免设置页其他快捷键先响应），Esc 取消
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.isComposing) return
      if (e.key === 'Escape') {
        setRecording(false)
        setDraft('')
        return
      }
      const accel = eventToAccelerator(e)
      if (accel === null) {
        // 只按住了修饰键：实时预览，等主键
        setDraft(
          `${[e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift']
            .filter(Boolean)
            .join('+')}+…`
        )
        return
      }
      if (accel === 'INVALID') {
        setDraft('需含 Ctrl 或 Alt（F 键可单独用），换个组合')
        return
      }
      setRecording(false)
      setDraft('')
      applyBossKey(accel)
    }
    const onBlur = (): void => {
      setRecording(false)
      setDraft('')
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onBlur)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording])

  return (
    <Card>
      <CardHeader title="通用" />
      <CardBody>
        <ToggleRow
          title="书库文件变动自动重扫"
          desc="往本地书库文件夹里加/删漫画后自动增量更新书架（约 5 秒延迟）"
          checked={autoRescan}
          disabled={configLoading || configSaving}
          onChange={(v) => {
            saveConfig('autoRescan', v, autoRescan, setAutoRescan)
          }}
        />
        <ToggleRow
          title="启动时打开上次阅读"
          desc="打开雨读 Yudu 后直接回到上次读到的位置"
          checked={resume}
          disabled={configLoading || configSaving}
          onChange={(v) => {
            saveConfig('resumeOnLaunch', v, resume, setResume)
          }}
        />
        {configError && <p role="alert" className="text-xs text-destructive">{configError}</p>}
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">老板键</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              全局隐藏/恢复窗口（任务栏与 Alt+Tab 都不显示）。点击右侧录制任意组合键，需含 Ctrl 或
              Alt；组合键会被系统级占用，其他程序与应用内同键位的快捷键一并失效
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => {
                setDraft('')
                setRecording(true)
              }}
              className={cn(
                'min-w-[8.5rem] rounded-md border px-2.5 py-1.5 text-center font-mono text-xs transition-colors',
                recording
                  ? 'animate-pulse border-primary bg-primary/10 text-primary'
                  : 'border-border/60 text-foreground hover:border-primary/50 hover:bg-accent'
              )}
            >
              {recording
                ? draft || '按下组合键…'
                : bossPref
                  ? // 被占用回退时显示实际生效键（bossHint 会说明原因）
                    formatAccelerator(bossActive || bossPref)
                  : bossActive
                    ? `自动 · ${formatAccelerator(bossActive)}`
                    : '自动'}
            </button>
            {bossPref && !recording && (
              <button
                onClick={() => applyBossKey('')}
                className="rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                title="清除录制的组合键，恢复按候选顺序自动挑选"
              >
                自动
              </button>
            )}
          </div>
        </div>
        {bossHint && <p className="text-xs text-warning">{bossHint}</p>}
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
    void window.yudu.data
      .export()
      .then((r) => {
        if (r)
          setMessage(`已导出 ${r.series} 个系列（${r.progress} 条进度、${r.bookmarks} 个书签）`)
      })
      .catch((e) => setMessage(errorMessage(e)))
      .finally(() => setBusy(null))
  }

  const doImport = (): void => {
    setBusy('import')
    setMessage('')
    void window.yudu.data
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
  const cacheFocusRef = useRef<HTMLSpanElement>(null)
  const [cacheError, setCacheError] = useState('')
  const [capGb, setCapGb] = useState('20')
  const [capDirty, setCapDirty] = useState(false)
  const [capSaved, setCapSaved] = useState(false)
  const [stats, setStats] = useState<{ totalBytes: number; files: number } | null>(null)
  const [list, setList] = useState<SeriesCache[]>([])
  const [busy, setBusy] = useState(false)
  const [cacheMessage, setCacheMessage] = useState('')
  const [confirmClear, setConfirmClear] = useState<
    { kind: 'all'; bytes: number; files: number } | { kind: 'series'; series: SeriesCache } | null
  >(null)

  const refresh = useCallback(async (): Promise<void> => {
    const [nextStats, nextList] = await Promise.all([
      window.yudu.cloud.cacheStats(),
      window.yudu.cloud.cacheBySeries()
    ])
    setStats(nextStats)
    setList(nextList)
  }, [])

  useEffect(() => {
    void window.yudu.cloud
      .cacheConfigGet()
      .then((mb) => setCapGb(String(mb / 1024)))
      .catch((error) => setCacheError(errorMessage(error)))
    void refresh().catch((error) => setCacheError(errorMessage(error)))
  }, [refresh])

  const saveCap = (): void => {
    const gb = Number.parseFloat(capGb)
    if (!Number.isFinite(gb) || gb <= 0) return
    setBusy(true)
    setCacheError('')
    void window.yudu.cloud
      .cacheConfigSet(Math.round(gb * 1024))
      .then((mb) => {
        setCapGb(String(mb / 1024))
        setCapDirty(false)
        setCapSaved(true)
        setTimeout(() => setCapSaved(false), 2000)
      })
      .catch((error) => setCacheError(errorMessage(error)))
      .finally(() => setBusy(false))
  }

  const clearConfirmed = async (): Promise<void> => {
    if (!confirmClear) return
    setBusy(true)
    setCacheError('')
    setCacheMessage('')
    try {
      const result = confirmClear.kind === 'all'
        ? await window.yudu.cloud.cacheClearAll()
        : await window.yudu.cloud.cacheClearSeries(confirmClear.series.seriesId)
      await refresh()
      setCacheMessage(`已清理 ${fmtBytes(result.bytes)} 云端缓存，封面与阅读进度保留。`)
    } catch (error) {
      setCacheError(errorMessage(error))
      throw error
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader title={<span ref={cacheFocusRef} tabIndex={-1} data-cache-focus-target className="rounded focus-visible:outline-2 focus-visible:outline-ring">云端缓存</span>} />
      <CardBody>
        {cacheError && <p className="text-xs text-destructive">{cacheError}</p>}
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
                超限自动清理未保护的缓存；整系列离线预取会开启保护，手动清理会取消下载并解除保护
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
              onClick={() => stats && setConfirmClear({ kind: 'all', bytes: stats.totalBytes, files: stats.files })}
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
                  data-cache-series-id={s.seriesId}
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
                    aria-label={`清除「${s.title}」的缓存`}
                    onClick={() => setConfirmClear({ kind: 'series', series: s })}
                  >
                    <Trash2 className="size-3" />
                    清除
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
        {cacheMessage && <p role="status" className="text-xs text-muted-foreground">{cacheMessage}</p>}
      </CardBody>
      {confirmClear && (
        <ConfirmDialog
          title={confirmClear.kind === 'all' ? '清除全部云端缓存' : '清除系列缓存'}
          tone="danger"
          confirmLabel={confirmClear.kind === 'all' ? '确认清除全部缓存' : '确认清除此系列缓存'}
          pendingLabel="正在清理缓存…"
          description={confirmClear.kind === 'all'
            ? '将删除全部云端书库的本地阅读缓存。之后阅读这些内容需要联网重新下载。'
            : <>将删除「{confirmClear.series.title}」的本地阅读缓存，之后阅读需要联网重新下载。</>}
          details={<div className="space-y-3">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-lg bg-muted/60 p-3 text-xs">
              <dt className="text-muted-foreground">清理范围</dt>
              <dd className="min-w-0 font-medium">{confirmClear.kind === 'all' ? '全部云端书库' : confirmClear.series.title}</dd>
              <dt className="text-muted-foreground">当前占用</dt>
              <dd className="tabular-nums">{fmtBytes(confirmClear.kind === 'all' ? confirmClear.bytes : confirmClear.series.bytes)}</dd>
              {confirmClear.kind === 'all' && <>
                <dt className="text-muted-foreground">缓存文件</dt>
                <dd>{confirmClear.files} 个</dd>
              </>}
            </dl>
            <p className="text-xs text-muted-foreground">清理会取消相关下载并解除离线保护。封面、阅读进度、书签和云端原文件保留。</p>
          </div>}
          onClose={() => setConfirmClear(null)}
          onConfirm={clearConfirmed}
          fallbackFocus={() => cacheFocusRef.current}
        />
      )}
    </Card>
  )
}

/** 应用更新：检查 -> 下载（进度）-> 立即重启。主渠道设置里可选，检查失败自动切备用 */
function UpdateSection() {
  const u = useUpdateStore()
  const [autoCheck, setAutoCheck] = useState(true)
  const [channel, setChannel] = useState<'r2' | 'github'>('r2')

  useEffect(() => {
    void window.yudu.config.get('autoCheckUpdate').then((v) => setAutoCheck(v !== false))
    void window.yudu.config
      .get('updateChannel')
      .then((v) => setChannel(v === 'github' ? 'github' : 'r2'))
      .catch(() => {})
  }, [])

  // 仅 available 状态下 version 才有效——latest 时后端也回传版本号(=当前版)，不能据此显示下载按钮
  const canDownload = u.status === 'available' && !u.ready
  const served = u.channel ? `，经${u.channel === 'github' ? 'GitHub' : 'R2'}渠道检查` : ''
  const msg = (() => {
    if (u.ready) return `新版本 v${u.ready} 已下载完成，点击「立即重启」生效`
    if (u.downloading) return '正在下载更新…（完成后可点击「立即重启」）'
    if (u.error)
      return u.status === 'error'
        ? `两个渠道都检查失败：${u.error}（请检查网络后重试）`
        : `下载失败：${u.error}`
    if (u.status === 'dev') return '开发模式不检查更新（打包版支持在线升级）'
    if (u.status === 'available')
      return `发现新版本 v${u.version}，点击「下载更新」获取（全量安装包${served}）`
    if (u.status === 'latest') return `已是最新版本（v${u.current}${served}）`
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
                雨读 Yudu
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
                主渠道{channel === 'r2' ? ' yudu-media.yeyushi.com（Cloudflare R2）' : ' GitHub Releases'}
                ，失败自动切备用，仅打包版支持在线升级
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
              {u.checking ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              检查更新
            </Button>
            {canDownload && (
              <Button size="sm" disabled={u.downloading} onClick={() => void u.download()}>
                {u.downloading ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Download className="size-3.5" />
                )}
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
            void window.yudu.config.set('autoCheckUpdate', v).catch(() => {})
          }}
        />

        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">更新渠道</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              主渠道检查失败时自动改用备用渠道重试，下载跟随检查成功的渠道
            </p>
          </div>
          <div className="flex shrink-0 rounded-full border border-border/60 p-0.5">
            {(['r2', 'github'] as const).map((ch) => (
              <button
                key={ch}
                onClick={() => {
                  setChannel(ch)
                  void window.yudu.config.set('updateChannel', ch).catch(() => {})
                }}
                title={
                  ch === 'r2'
                    ? 'yudu-media.yeyushi.com（Cloudflare R2）'
                    : 'github.com/mkktop/Yudu Releases'
                }
                className={cn(
                  'rounded-full px-3 py-1 text-xs transition-colors',
                  channel === ch
                    ? 'bg-primary font-medium text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {ch === 'r2' ? 'R2' : 'GitHub'}
              </button>
            ))}
          </div>
        </div>
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
    return window.yudu.diagnose
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
      await window.yudu.series.rescan(seriesId)
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
      await window.yudu.series.remove(id)
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
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={running}
            onClick={() => void run()}
          >
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
              {report.emptyChapters.length === 0 && (
                <p className="text-xs text-muted-foreground">没有空章节</p>
              )}
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

            <DiagnoseList
              label="孤儿页缩略图（章节已删除）"
              count={report.orphanThumbBytes > 0 ? 1 : 0}
            >
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
  const sections = [
    { id: 'appearance', label: '外观', content: <ThemeSettings /> },
    { id: 'reading', label: '阅读', content: <ReaderDefaultsSection /> },
    { id: 'general', label: '通用', content: <GeneralSection /> },
    { id: 'cache', label: '缓存', content: <CloudCacheSection /> },
    { id: 'data', label: '进度', content: <DataSection /> },
    { id: 'backup', label: '备份', content: <BackupSection /> },
    { id: 'diagnose', label: '诊断', content: <DiagnoseSection /> },
    { id: 'update', label: '更新', content: <UpdateSection /> }
  ]
  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-8">
      <header>
        <h1 className="font-serif text-2xl font-semibold">设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">按你的阅读习惯，布置自己的书房</p>
      </header>
      <nav aria-label="设置分区" className="sticky top-0 z-10 flex flex-wrap gap-1 rounded-xl border border-border/60 bg-background/95 p-1.5 shadow-xs backdrop-blur-md">
        {sections.map((section) => (
          <button type="button" key={section.id} onClick={() => document.getElementById(`settings-${section.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
            {section.label}
          </button>
        ))}
      </nav>
      {sections.map((section) => <div key={section.id} id={`settings-${section.id}`} className="scroll-mt-16">{section.content}</div>)}
    </div>
  )
}
