import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ChevronRight,
  Cloud,
  CloudUpload,
  FileArchive,
  Folder,
  FolderPlus,
  Loader2,
  LogOut,
  RefreshCw,
  Trash2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAsync } from '@/hooks/useAsync'
import { useDataStore } from '@/stores/data'
import { cn, errorMessage } from '@/lib/utils'
import type { CloudBrowseResult, CloudStatus, Series } from '@shared/types'

/** 挂载目录（libraries 表里的云端库） */
interface MountRow {
  id: number
  name: string
  path: string
  kind: string
  cloud_folder_id?: string | null
  family_id?: string | null
}

interface Family {
  id: string
  name: string
}

type QrState = 'waiting' | 'scanned' | 'done' | 'expired'

/**
 * 多网盘 provider 注册表。接新网盘时在主进程实现对应 client/scanner 后，
 * 把 available 打开即可出现在「添加网盘」里。
 */
const PROVIDERS = [
  { id: 'cloud189', name: '天翼云盘', desc: '个人云与家庭云', available: true },
  { id: '115', name: '115 网盘', desc: '个人云盘', available: true },
  { id: 'aliyundrive', name: '阿里云盘', desc: '即将支持', available: false },
  { id: 'baidu', name: '百度网盘', desc: '即将支持', available: false },
  { id: 'onedrive', name: 'OneDrive', desc: '即将支持', available: false }
]

function fmtSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * 云盘页（两层结构）：
 * 1. 网盘列表 —— 只看连接状态，不加载任何目录；点进具体网盘才进入第 2 层
 * 2. 单网盘 —— 目录浏览、管理已挂载目录、添加新挂载
 */
export function CloudPage() {
  const [status, setStatus] = useState<CloudStatus | null>(null)
  const [status115, setStatus115] = useState<CloudStatus | null>(null)
  /** null = 网盘列表；provider id = 已进入该网盘 */
  const [entered, setEntered] = useState<string | null>(null)

  useEffect(() => {
    void window.yiben.cloud.status().then(setStatus)
    void window.yiben.cloud115.status().then(setStatus115)
  }, [])

  if (!status || !status115) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <CloudHeader />
        <div className="rounded-xl border p-5 text-sm text-muted-foreground">加载中…</div>
      </div>
    )
  }

  if (entered === 'cloud189') {
    return (
      <Cloud189Drive
        status={status}
        onStatus={setStatus}
        onExit={() => setEntered(null)}
      />
    )
  }
  if (entered === '115') {
    return (
      <Cloud115Drive
        status={status115}
        onStatus={setStatus115}
        onExit={() => setEntered(null)}
      />
    )
  }

  return (
    <DriveList
      status={status}
      status115={status115}
      onStatus={setStatus}
      onStatus115={setStatus115}
      onEnterCloud189={() => setEntered('cloud189')}
      onEnter115={() => setEntered('115')}
    />
  )
}

function CloudHeader() {
  return (
    <header className="mb-6">
      <h1 className="font-serif text-2xl font-semibold">网盘</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        连接网盘账号，把云端的漫画目录挂载到书架
      </p>
    </header>
  )
}

// ---------- 扫码登录（天翼 / 115 共用） ----------

interface QrApi {
  start: () => Promise<{ dataUrl: string }>
  poll: () => Promise<{ state: QrState; username?: string }>
}

/**
 * 扫码登录状态机：打开面板即取码；2.5 秒轮询扫码状态，确认后主进程已完成会话建立。
 * 过期/出错时由面板提供「刷新二维码」。
 */
function useCloudQr(api: QrApi, open: boolean, onDone: () => Promise<void>): {
  image: string
  state: QrState
  error: string
  refresh: () => void
} {
  const [image, setImage] = useState('')
  const [state, setState] = useState<QrState>('waiting')
  const [error, setError] = useState('')
  const pollingRef = useRef(false)

  const refresh = useCallback((): void => {
    setError('')
    setState('waiting')
    setImage('')
    api
      .start()
      .then((r) => setImage(r.dataUrl))
      .catch((e) => setError(errorMessage(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    refresh()
    const timer = setInterval(() => {
      if (pollingRef.current) return
      pollingRef.current = true
      api
        .poll()
        .then(async (r) => {
          setState(r.state)
          if (r.state === 'done') {
            await onDone()
            setState('waiting')
          }
        })
        .catch(() => {})
        .finally(() => {
          pollingRef.current = false
        })
    }, 2500)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return { image, state, error, refresh }
}

function QrLoginPanel({
  image,
  state,
  hint,
  guide,
  error,
  onRefresh,
  onClose,
  closeLabel
}: {
  image: string
  state: QrState
  /** 当前状态的提示语（waiting/scanned/done/expired 各一句） */
  hint: string
  guide: string
  error: string
  onRefresh: () => void
  onClose: () => void
  closeLabel: string
}) {
  return (
    <div className="mt-4 border-t border-border/60 pt-4">
      <div className="flex items-center gap-5">
        <div className="relative size-40 shrink-0 overflow-hidden rounded-lg border bg-white p-1.5">
          {image ? (
            <img src={image} alt="登录二维码" className="size-full" />
          ) : (
            <div className="grid size-full place-items-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {state === 'expired' && (
            <div className="absolute inset-0 grid place-items-center bg-black/70">
              <Button size="sm" variant="outline" onClick={onRefresh}>
                <RefreshCw />
                刷新二维码
              </Button>
            </div>
          )}
        </div>
        <div className="min-w-0 text-xs text-muted-foreground">
          <p className="text-sm font-medium text-foreground">{hint}</p>
          <p className="mt-1.5">{guide}</p>
          <button
            className="mt-2 text-primary underline-offset-2 hover:underline"
            onClick={onClose}
          >
            {closeLabel}
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}

// ---------- 第 1 层：网盘列表 ----------

function DriveList({
  status,
  status115,
  onStatus,
  onStatus115,
  onEnterCloud189,
  onEnter115
}: {
  status: CloudStatus
  status115: CloudStatus
  onStatus: (s: CloudStatus) => void
  onStatus115: (s: CloudStatus) => void
  onEnterCloud189: () => void
  onEnter115: () => void
}) {
  const [showLogin, setShowLogin] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // 两家网盘各自的扫码登录面板
  const [qr189Open, setQr189Open] = useState(false)
  const [qr115Open, setQr115Open] = useState(false)

  const qr189 = useCloudQr(window.yiben.cloud.qr, qr189Open, async () => {
    onStatus(await window.yiben.cloud.status())
    setQr189Open(false)
  })
  const qr115 = useCloudQr(window.yiben.cloud115.qr, qr115Open, async () => {
    onStatus115(await window.yiben.cloud115.status())
    setQr115Open(false)
  })

  // 卡片上只取容量数字（轻接口），目录列表等点进网盘才加载
  const { data: capacity } = useAsync(
    () => (status.loggedIn ? window.yiben.cloud.capacity(undefined) : Promise.resolve(null)),
    [status.loggedIn]
  )
  const { data: capacity115 } = useAsync(
    () => (status115.loggedIn ? window.yiben.cloud115.capacity() : Promise.resolve(null)),
    [status115.loggedIn]
  )
  const { data: mounts } = useAsync<MountRow[]>(() => window.yiben.libraries.list(), [])
  const cloud189Mounts = (mounts ?? []).filter((m) => m.kind === 'cloud189')
  const mounts115 = (mounts ?? []).filter((m) => m.kind === '115')

  const login = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      onStatus(await window.yiben.cloud.login(username, password))
      setPassword('')
      setShowLogin(false)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <CloudHeader />

      {/* 已连接 / 待连接的网盘 */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">我的网盘</h2>

        {/* 天翼云盘 */}
        <div className="rounded-xl border p-5">
          <DriveCardRow
            name="天翼云盘"
            username={status.username}
            loggedIn={status.loggedIn}
            mountCount={cloud189Mounts.length}
            capacity={capacity}
            capacityLabel="个人云空间"
          />
          {status.loggedIn ? (
            <div className="mt-3 flex justify-end">
              <Button size="sm" onClick={onEnterCloud189}>
                进入
                <ChevronRight />
              </Button>
            </div>
          ) : (
            <div className="mt-3 flex shrink-0 justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setQr189Open((v) => !v)}>
                扫码登录
              </Button>
              <Button
                size="sm"
                variant={showLogin ? 'outline' : 'default'}
                onClick={() => setShowLogin((v) => !v)}
              >
                <CloudUpload />
                密码登录
              </Button>
            </div>
          )}

          {/* 扫码登录面板：官方渲染的二维码 + 轮询状态 */}
          {qr189Open && !status.loggedIn && (
            <QrLoginPanel
              image={qr189.image}
              state={qr189.state}
              hint={
                qr189.state === 'waiting'
                  ? '请用天翼云盘 App「扫一扫」'
                  : qr189.state === 'scanned'
                    ? '已扫码，请在手机上确认登录'
                    : qr189.state === 'done'
                      ? '登录成功'
                      : '二维码已过期'
              }
              guide="打开天翼云盘 App，右上角「扫一扫」扫描左侧二维码，在手机上确认后本应用将自动完成登录。"
              error={qr189.error}
              onRefresh={qr189.refresh}
              onClose={() => setQr189Open(false)}
              closeLabel="收起，改用密码登录"
            />
          )}

          {showLogin && !status.loggedIn && (
            <form
              className="mt-4 flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault()
                if (!busy && username && password) void login()
              }}
            >
              <Input
                placeholder="手机号 / 用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <Input
                type="password"
                placeholder="密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button type="submit" disabled={busy || !username || !password}>
                {busy ? <Loader2 className="animate-spin" /> : <CloudUpload />}
                登录
              </Button>
            </form>
          )}
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
          {showLogin && !status.loggedIn && (
            <p className="mt-2 text-xs text-muted-foreground">凭据只保存在本机（系统级加密）</p>
          )}
        </div>

        {/* 115 网盘 */}
        <div className="rounded-xl border p-5">
          <DriveCardRow
            name="115 网盘"
            username={status115.username}
            loggedIn={status115.loggedIn}
            mountCount={mounts115.length}
            capacity={capacity115}
            capacityLabel="云空间"
          />
          {status115.loggedIn ? (
            <div className="mt-3 flex justify-end">
              <Button size="sm" onClick={onEnter115}>
                进入
                <ChevronRight />
              </Button>
            </div>
          ) : (
            <div className="mt-3 flex shrink-0 justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setQr115Open((v) => !v)}>
                扫码登录
              </Button>
            </div>
          )}

          {qr115Open && !status115.loggedIn && (
            <QrLoginPanel
              image={qr115.image}
              state={qr115.state}
              hint={
                qr115.state === 'waiting'
                  ? '请用 115 App「扫一扫」'
                  : qr115.state === 'scanned'
                    ? '已扫码，请在手机上确认登录'
                    : qr115.state === 'done'
                      ? '登录成功'
                      : '二维码已过期'
              }
              guide="打开 115 App，右上角「扫一扫」扫描左侧二维码，在手机上确认后本应用将自动完成登录。"
              error={qr115.error}
              onRefresh={qr115.refresh}
              onClose={() => setQr115Open(false)}
              closeLabel="收起"
            />
          )}
        </div>
      </section>

      {/* 添加网盘（多网盘架构的扩展入口） */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">添加网盘</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {PROVIDERS.map((p) => {
            const connected =
              (p.id === 'cloud189' && status.loggedIn) || (p.id === '115' && status115.loggedIn)
            return (
              <button
                key={p.id}
                disabled={!p.available || connected}
                onClick={() => {
                  if (p.id === 'cloud189') setQr189Open(true)
                  if (p.id === '115') setQr115Open(true)
                }}
                title={
                  connected
                    ? '已连接'
                    : p.available
                      ? '连接账号'
                      : '即将支持，敬请期待'
                }
                className={cn(
                  'flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-colors',
                  connected
                    ? 'border-primary/40 bg-primary/5'
                    : p.available
                      ? 'hover:border-primary/40 hover:bg-accent'
                      : 'cursor-not-allowed opacity-45'
                )}
              >
                <Cloud className="size-5 text-muted-foreground" />
                <span className="text-sm">{p.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {connected ? '已连接' : p.desc}
                </span>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

/** 网盘卡片的状态行：图标 + 名称 + 账号/挂载/容量摘要 */
function DriveCardRow({
  name,
  username,
  loggedIn,
  mountCount,
  capacity,
  capacityLabel
}: {
  name: string
  username: string
  loggedIn: boolean
  mountCount: number
  capacity: { total: number; free: number } | null | undefined
  capacityLabel: string
}) {
  return (
    <div className="flex items-center gap-4">
      <div
        className={cn(
          'grid size-11 place-items-center rounded-lg',
          loggedIn ? 'bg-primary/10' : 'bg-muted'
        )}
      >
        <Cloud className={cn('size-5', loggedIn ? 'text-primary' : 'text-muted-foreground')} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {name}
          {loggedIn && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">{username}</span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {loggedIn
            ? mountCount > 0
              ? `已挂载 ${mountCount} 个目录`
              : '还没有挂载目录'
            : '未连接'}
          {capacity && capacity.total > 0 && (
            <span className="ml-2">
              · {capacityLabel} {((capacity.total - capacity.free) / 1024 ** 3).toFixed(1)} /{' '}
              {(capacity.total / 1024 ** 3).toFixed(1)} GB
            </span>
          )}
        </p>
      </div>
    </div>
  )
}

// ---------- 挂载目录列表（天翼 / 115 共用） ----------

function MountListSection({
  mounts,
  seriesList,
  spaceLabel,
  busy,
  confirmId,
  setConfirmId,
  rescanningId,
  onRemove,
  onRescan
}: {
  mounts: MountRow[] | undefined
  seriesList: Series[] | undefined
  spaceLabel: (lib: MountRow) => string
  busy: boolean
  confirmId: number | null
  setConfirmId: (id: number | null) => void
  rescanningId: number | null
  onRemove: (lib: MountRow) => void
  onRescan: (lib: MountRow) => void
}) {
  const seriesCount = (libraryId: number): number =>
    (seriesList ?? []).filter((s) => s.library_id === libraryId).length

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">已挂载目录</h2>
        <span className="text-xs text-muted-foreground">{mounts?.length ?? 0} 个</span>
      </div>
      <div className="divide-y divide-border/60 rounded-xl border">
        {(mounts ?? []).length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            还没有挂载目录，在下方浏览并添加
          </p>
        ) : (
          (mounts ?? []).map((lib) => (
            <div key={lib.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{lib.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {spaceLabel(lib)} · {seriesCount(lib.id)} 部漫画
                  </p>
                </div>
                {confirmId === lib.id ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 px-2.5 text-xs"
                      disabled={busy}
                      onClick={() => onRemove(lib)}
                    >
                      确认移除
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
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-muted-foreground"
                      disabled={rescanningId !== null}
                      onClick={() => onRescan(lib)}
                      title="重新扫描该目录"
                    >
                      <RefreshCw className={cn('size-3.5', rescanningId === lib.id && 'animate-spin')} />
                      {rescanningId === lib.id ? '扫描中' : '重扫'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                      disabled={busy}
                      onClick={() => setConfirmId(lib.id)}
                    >
                      <Trash2 className="size-3.5" />
                      移除
                    </Button>
                  </div>
                )}
              </div>
              {confirmId === lib.id && (
                <p className="mt-1.5 pl-7 text-xs text-destructive">
                  将从书架移除该目录的全部漫画与阅读进度，云端缓存一并清理，云端原文件不受影响。
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  )
}

// ---------- 目录浏览（天翼 / 115 共用） ----------

function BrowseSection({
  stack,
  browse,
  browsing,
  error,
  onReload,
  onUp,
  onRoot,
  onCrumb,
  onEnter,
  addLabel,
  onAdd,
  addBusy
}: {
  stack: Array<{ id: string; name: string }>
  browse: CloudBrowseResult | null
  browsing: boolean
  error: string
  onReload: () => void
  onUp: () => void
  onRoot: () => void
  onCrumb: (s: { id: string; name: string }, i: number) => void
  onEnter: (f: { id: string; name: string }) => void
  addLabel: string
  onAdd: () => void
  addBusy: boolean
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">
          浏览目录<span className="ml-2 text-xs font-normal text-muted-foreground">添加新挂载</span>
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onReload}
          title="刷新"
          disabled={browsing}
        >
          <RefreshCw className={cn('size-3.5', browsing && 'animate-spin')} />
        </Button>
      </div>

      {/* 面包屑（可点任意层级直达） */}
      <div className="flex min-h-7 flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {stack.length > 0 && (
          <button
            onClick={onUp}
            className="grid size-6 place-items-center rounded hover:bg-accent"
            title="上一级"
          >
            <ArrowLeft className="size-3.5" />
          </button>
        )}
        <button
          onClick={onRoot}
          className={cn('rounded px-1 hover:text-foreground', stack.length === 0 && 'text-foreground')}
        >
          根目录
        </button>
        {stack.map((s, i) => (
          <span key={s.id} className="flex items-center gap-1">
            <span className="opacity-40">/</span>
            <button
              onClick={() => onCrumb(s, i)}
              className={cn(
                'rounded px-1 hover:text-foreground',
                i === stack.length - 1 && 'text-foreground'
              )}
            >
              {s.name}
            </button>
          </span>
        ))}
      </div>

      <div className="max-h-80 min-h-28 overflow-y-auto rounded-lg border">
        {browsing ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : error && !browse ? (
          <p className="px-3 py-8 text-center text-xs text-destructive">{error}</p>
        ) : !browse || (browse.folders.length === 0 && browse.files.length === 0) ? (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">
            此目录为空
          </p>
        ) : (
          <>
            {browse.folders.map((f) => (
              <button
                key={f.id}
                onClick={() => onEnter(f)}
                className="flex w-full items-center gap-2 border-b border-border/60 px-3 py-2.5 text-left text-sm last:border-0 hover:bg-accent"
              >
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{f.name}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">进入</span>
              </button>
            ))}
            {browse.files.length > 0 && (
              <div className="border-t border-border bg-muted/30 px-3 py-1.5">
                <p className="py-1 text-[11px] text-muted-foreground">
                  文件 {browse.files.length} 个（挂载所在目录后自动识别漫画压缩包）
                </p>
                {browse.files.slice(0, 30).map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-2 py-1 text-xs text-muted-foreground"
                  >
                    <FileArchive className="size-3.5 shrink-0 opacity-60" />
                    <span className="truncate">{f.name}</span>
                    {(f.size ?? 0) > 0 && (
                      <span className="ml-auto shrink-0">{fmtSize(f.size ?? 0)}</span>
                    )}
                  </div>
                ))}
                {browse.files.length > 30 && (
                  <p className="py-1 text-[11px] text-muted-foreground">
                    …其余 {browse.files.length - 30} 个从略
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <Button size="sm" className="w-full" disabled={addBusy || browsing} onClick={onAdd}>
        {addBusy ? <Loader2 className="animate-spin" /> : <FolderPlus />}
        {addLabel}
      </Button>
    </section>
  )
}

// ---------- 第 2 层：单个网盘（天翼云盘） ----------

function Cloud189Drive({
  status,
  onStatus,
  onExit
}: {
  status: CloudStatus
  onStatus: (s: CloudStatus) => void
  onExit: () => void
}) {
  const bump = useDataStore((s) => s.bump)
  const version = useDataStore((s) => s.version)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [capacity, setCapacity] = useState<{ total: number; free: number } | null>(null)
  const [families, setFamilies] = useState<Family[]>([])
  const [familyId, setFamilyId] = useState<string>('')
  const [stack, setStack] = useState<Array<{ id: string; name: string }>>([])
  const [browse, setBrowse] = useState<CloudBrowseResult | null>(null)
  const [browsing, setBrowsing] = useState(false)

  const current = stack[stack.length - 1]
  const famId = familyId || undefined

  // 容量请求失败（登录恢复竞态/网络抖动）3 秒后自动重试一次，避免空间栏永久空白
  const capRetry = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadCapacity = useCallback((fam: string | undefined): void => {
    if (capRetry.current) clearTimeout(capRetry.current)
    void window.yiben.cloud
      .capacity(fam)
      .then(setCapacity)
      .catch(() => {
        capRetry.current = setTimeout(() => {
          void window.yiben.cloud.capacity(fam).then(setCapacity).catch(() => {})
        }, 3000)
      })
  }, [])
  useEffect(() => () => { if (capRetry.current) clearTimeout(capRetry.current) }, [])

  /**
   * 加载目录。refresh 为 true 时不压栈（刷新当前层），
   * 修掉旧实现「刷新会往面包屑里重复压一层」的问题。
   */
  const browseInto = useCallback(
    (id: string | undefined, name: string, fam: string | undefined, refresh = false): void => {
      setBrowsing(true)
      void window.yiben.cloud
        .browse(id, fam)
        .then((r) => {
          setBrowse(r)
          if (refresh) return
          if (id) setStack((s) => [...s, { id, name }])
          else setStack([])
        })
        .catch((e) => setError(errorMessage(e)))
        .finally(() => setBrowsing(false))
    },
    []
  )

  const reloadCurrent = useCallback((): void => {
    browseInto(current?.id, current?.name ?? '根目录', famId, true)
  }, [browseInto, current?.id, current?.name, famId])

  // 进入网盘 / 切换个人云与家庭云 → 加载对应空间（容量跟随当前空间）
  useEffect(() => {
    loadCapacity(famId)
    setStack([])
    browseInto(undefined, '根目录', famId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId])

  useEffect(() => {
    void window.yiben.cloud.families().then(setFamilies).catch(() => {})
  }, [])

  const logout = async (): Promise<void> => {
    onStatus(await window.yiben.cloud.logout())
    onExit()
  }

  // 已挂载目录（含各目录的系列数）；变更后靠 bump() 刷新
  const { data: mounts } = useAsync<MountRow[]>(
    () => window.yiben.libraries.list().then((all: MountRow[]) => all.filter((m) => m.kind === 'cloud189')),
    [version]
  )
  const { data: seriesList } = useAsync<Series[]>(
    () => window.yiben.series.list({ limit: 5000 }),
    [version]
  )

  const spaceLabel = (lib: MountRow): string =>
    lib.family_id
      ? `家庭云 · ${families.find((f) => f.id === lib.family_id)?.name ?? ''}`
      : '个人云'

  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [rescanningId, setRescanningId] = useState<number | null>(null)

  const removeMount = async (lib: MountRow): Promise<void> => {
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

  const rescanMount = async (lib: MountRow): Promise<void> => {
    setRescanningId(lib.id)
    setError('')
    try {
      await window.yiben.libraries.rescan(lib.id)
      bump()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setRescanningId(null)
    }
  }

  const addMount = (): void => {
    const defaultName = famId
      ? (families.find((f) => f.id === famId)?.name ?? '家庭云')
      : '个人云'
    setBusy(true)
    void window.yiben.cloud
      .addLibrary(current?.id ?? '-11', famId, current?.name ?? defaultName)
      .then(() => bump())
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      {/* 网盘头 */}
      <div className="space-y-4">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <button onClick={onExit} className="rounded px-1 py-0.5 hover:bg-accent hover:text-foreground">
            网盘
          </button>
          <span className="opacity-40">/</span>
          <span className="text-foreground">天翼云盘</span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="grid size-11 place-items-center rounded-lg bg-primary/10">
              <Cloud className="size-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">{status.username}</p>
              {capacity && capacity.total > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {familyId ? '家庭云空间' : '个人云空间'}{' '}
                  {((capacity.total - capacity.free) / 1024 ** 3).toFixed(1)} /{' '}
                  {(capacity.total / 1024 ** 3).toFixed(1)} GB
                </p>
              )}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            <LogOut />
            断开
          </Button>
        </div>

        {capacity && capacity.total > 0 && (
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{
                width: `${Math.round(((capacity.total - capacity.free) / capacity.total) * 100)}%`
              }}
            />
          </div>
        )}

        {/* 云空间切换：个人云 / 各家庭云 */}
        <div className="flex flex-wrap gap-2">
          <SourceChip active={familyId === ''} onClick={() => setFamilyId('')} label="个人云" />
          {families.map((f) => (
            <SourceChip
              key={f.id}
              active={familyId === f.id}
              onClick={() => setFamilyId(f.id)}
              label={`家庭云：${f.name}`}
            />
          ))}
        </div>
      </div>

      <MountListSection
        mounts={mounts}
        seriesList={seriesList}
        spaceLabel={spaceLabel}
        busy={busy}
        confirmId={confirmId}
        setConfirmId={setConfirmId}
        rescanningId={rescanningId}
        onRemove={(lib) => void removeMount(lib)}
        onRescan={(lib) => void rescanMount(lib)}
      />

      <BrowseSection
        stack={stack}
        browse={browse}
        browsing={browsing}
        error={error}
        onReload={reloadCurrent}
        onUp={() => {
          const next = [...stack]
          next.pop()
          setStack(next)
          const parent = next[next.length - 1]
          browseInto(parent?.id, parent?.name ?? '根目录', famId, true)
        }}
        onRoot={() => {
          setStack([])
          browseInto(undefined, '根目录', famId, true)
        }}
        onCrumb={(s, i) => {
          setStack(stack.slice(0, i + 1))
          browseInto(s.id, s.name, famId, true)
        }}
        onEnter={(f) => browseInto(f.id, f.name, famId)}
        addLabel={`把「${current?.name ?? '根目录'}」加入挂载`}
        onAdd={addMount}
        addBusy={busy}
      />

      {error && browse && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

// ---------- 第 2 层：单个网盘（115 网盘） ----------

function Cloud115Drive({
  status,
  onStatus,
  onExit
}: {
  status: CloudStatus
  onStatus: (s: CloudStatus) => void
  onExit: () => void
}) {
  const bump = useDataStore((s) => s.bump)
  const version = useDataStore((s) => s.version)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [capacity, setCapacity] = useState<{ total: number; free: number } | null>(null)
  const [stack, setStack] = useState<Array<{ id: string; name: string }>>([])
  const [browse, setBrowse] = useState<CloudBrowseResult | null>(null)
  const [browsing, setBrowsing] = useState(false)

  const current = stack[stack.length - 1]

  const browseInto = useCallback(
    (id: string | undefined, name: string, refresh = false): void => {
      setBrowsing(true)
      void window.yiben.cloud115
        .browse(id)
        .then((r) => {
          setBrowse(r)
          if (refresh) return
          if (id) setStack((s) => [...s, { id, name }])
          else setStack([])
        })
        .catch((e) => setError(errorMessage(e)))
        .finally(() => setBrowsing(false))
    },
    []
  )

  const reloadCurrent = useCallback((): void => {
    browseInto(current?.id, current?.name ?? '根目录', true)
  }, [browseInto, current?.id, current?.name])

  useEffect(() => {
    setStack([])
    browseInto(undefined, '根目录')
    void window.yiben.cloud115.capacity().then(setCapacity).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const logout = async (): Promise<void> => {
    onStatus(await window.yiben.cloud115.logout())
    onExit()
  }

  const { data: mounts } = useAsync<MountRow[]>(
    () => window.yiben.libraries.list().then((all: MountRow[]) => all.filter((m) => m.kind === '115')),
    [version]
  )
  const { data: seriesList } = useAsync<Series[]>(
    () => window.yiben.series.list({ limit: 5000 }),
    [version]
  )

  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [rescanningId, setRescanningId] = useState<number | null>(null)

  const removeMount = async (lib: MountRow): Promise<void> => {
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

  const rescanMount = async (lib: MountRow): Promise<void> => {
    setRescanningId(lib.id)
    setError('')
    try {
      await window.yiben.libraries.rescan(lib.id)
      bump()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setRescanningId(null)
    }
  }

  const addMount = (): void => {
    setBusy(true)
    void window.yiben.cloud115
      .addLibrary(current?.id ?? '0', current?.name ?? '根目录')
      .then(() => bump())
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      {/* 网盘头 */}
      <div className="space-y-4">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <button onClick={onExit} className="rounded px-1 py-0.5 hover:bg-accent hover:text-foreground">
            网盘
          </button>
          <span className="opacity-40">/</span>
          <span className="text-foreground">115 网盘</span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="grid size-11 place-items-center rounded-lg bg-primary/10">
              <Cloud className="size-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">{status.username}</p>
              {capacity && capacity.total > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  云空间 {((capacity.total - capacity.free) / 1024 ** 3).toFixed(1)} /{' '}
                  {(capacity.total / 1024 ** 3).toFixed(1)} GB
                </p>
              )}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            <LogOut />
            断开
          </Button>
        </div>

        {capacity && capacity.total > 0 && (
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{
                width: `${Math.round(((capacity.total - capacity.free) / capacity.total) * 100)}%`
              }}
            />
          </div>
        )}
      </div>

      <MountListSection
        mounts={mounts}
        seriesList={seriesList}
        spaceLabel={() => '云空间'}
        busy={busy}
        confirmId={confirmId}
        setConfirmId={setConfirmId}
        rescanningId={rescanningId}
        onRemove={(lib) => void removeMount(lib)}
        onRescan={(lib) => void rescanMount(lib)}
      />

      <BrowseSection
        stack={stack}
        browse={browse}
        browsing={browsing}
        error={error}
        onReload={reloadCurrent}
        onUp={() => {
          const next = [...stack]
          next.pop()
          setStack(next)
          const parent = next[next.length - 1]
          browseInto(parent?.id, parent?.name ?? '根目录', true)
        }}
        onRoot={() => {
          setStack([])
          browseInto(undefined, '根目录', true)
        }}
        onCrumb={(s, i) => {
          setStack(stack.slice(0, i + 1))
          browseInto(s.id, s.name, true)
        }}
        onEnter={(f) => browseInto(f.id, f.name)}
        addLabel={`把「${current?.name ?? '根目录'}」加入挂载`}
        onAdd={addMount}
        addBusy={busy}
      />

      {error && browse && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function SourceChip({
  active,
  onClick,
  label
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full px-3.5 py-1.5 text-xs transition-colors',
        active
          ? 'bg-primary font-medium text-primary-foreground'
          : 'bg-muted text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
    </button>
  )
}
