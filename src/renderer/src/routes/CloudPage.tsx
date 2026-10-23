import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, Cloud, CloudUpload, Loader2, LogOut, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { useAsync } from '@/hooks/useAsync'
import { useDataStore } from '@/stores/data'
import { cn, errorMessage } from '@/lib/utils'
import { createDirectoryNavigation } from '@/lib/orderedInteraction'
import { createQrLogin, type QrApi, type QrState } from '@/lib/qrLogin'
import type { CloudBrowseResult, CloudStatus, Series } from '@shared/types'
import { WebDavSection } from '@/components/WebDavSection'
import { BrowseSection, KindBadge, MountListSection, type MountRow } from '@/components/library/CloudShared'

interface Family {
  id: string
  name: string
}

type DirectoryPath = Array<{ id: string; name: string }>

/**
 * 多网盘 provider 注册表。接新网盘时在主进程实现对应 client/scanner 后，
 * 把 available 打开即可出现在「添加网盘」里。
 */
const PROVIDERS = [
  { id: 'cloud189', name: '天翼云盘', desc: '个人云与家庭云', available: true },
  { id: '115', name: '115 网盘', desc: '个人云盘', available: true },
  { id: 'webdav', name: 'WebDAV / NAS', desc: '自建服务与局域网书库', available: true },
  { id: 'aliyundrive', name: '阿里云盘', desc: '即将支持', available: false },
  { id: 'baidu', name: '百度网盘', desc: '即将支持', available: false },
  { id: 'onedrive', name: 'OneDrive', desc: '即将支持', available: false }
]

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
    void window.yudu.cloud.status().then(setStatus)
    void window.yudu.cloud115.status().then(setStatus115)
  }, [])

  if (!status || !status115) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-6 p-8">
        <CloudHeader />
        <Card className="p-5">
          <p className="text-sm text-muted-foreground">加载中…</p>
        </Card>
      </div>
    )
  }

  if (entered === 'cloud189') {
    return <Cloud189Drive status={status} onStatus={setStatus} onExit={() => setEntered(null)} />
  }
  if (entered === '115') {
    return (
      <Cloud115Drive status={status115} onStatus={setStatus115} onExit={() => setEntered(null)} />
    )
  }

  return (
    <div>
      <DriveList
        status={status}
        status115={status115}
        onStatus={setStatus}
        onStatus115={setStatus115}
        onEnterCloud189={() => setEntered('cloud189')}
        onEnter115={() => setEntered('115')}
      />
      <div id="webdav-section" className="mx-auto max-w-[1400px] px-8 pb-8">
        <WebDavSection />
      </div>
    </div>
  )
}

function CloudHeader() {
  return (
    <header className="mb-6">
      <h1 className="font-serif text-2xl font-semibold">网盘</h1>
      <p className="mt-1 text-sm text-muted-foreground">连接网盘账号，把云端的漫画目录挂载到书架</p>
    </header>
  )
}

// ---------- 扫码登录（天翼 / 115 共用） ----------

/**
 * 扫码登录状态机：打开面板即取码；2.5 秒轮询扫码状态，确认后主进程已完成会话建立。
 * 过期/出错时由面板提供「刷新二维码」。
 */
function useCloudQr(
  api: QrApi,
  open: boolean,
  onDone: () => Promise<void>
): {
  image: string
  state: QrState
  error: string
  loading: boolean
  refresh: () => void
} {
  const [image, setImage] = useState('')
  const [state, setState] = useState<QrState>('waiting')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const login = useRef(createQrLogin(api, {
    image: setImage,
    state: setState,
    error: setError,
    loading: setLoading,
    done: onDone
  }))

  const refresh = useCallback((): void => {
    void login.current.refresh()
  }, [])

  useEffect(() => {
    if (!open) return
    refresh()
    const timer = setInterval(() => {
      void login.current.poll()
    }, 2500)
    return () => {
      clearInterval(timer)
      login.current.close()
    }
  }, [open, refresh])

  // 二维码过期 1.5 秒后自动换新码（官方 App 的行为）；面板上的手动按钮仅作兜底
  useEffect(() => {
    if (!open || state !== 'expired') return
    const timer = setTimeout(() => refresh(), 1500)
    return () => clearTimeout(timer)
  }, [state, open, refresh])

  return { image, state, error, loading, refresh }
}

function QrLoginPanel({
  image,
  state,
  hint,
  guide,
  error,
  loading,
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
  loading: boolean
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
          ) : loading ? (
            <div className="grid size-full place-items-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid size-full place-items-center p-2 text-center text-xs text-destructive">
              二维码获取失败
            </div>
          )}
          {state === 'expired' && (
            <div className="absolute inset-0 grid place-items-center bg-black/70">
              <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
                <RefreshCw />
                刷新二维码
              </Button>
            </div>
          )}
        </div>
        <div className="min-w-0 text-xs text-muted-foreground">
          <p className="text-sm font-medium text-foreground">{hint}</p>
          <p className="mt-1.5">{guide}</p>
          {error && (
            <Button size="sm" variant="outline" className="mt-2" disabled={loading} onClick={onRefresh}>
              <RefreshCw />
              重新获取二维码
            </Button>
          )}
          <button
            className="mt-2 text-primary underline-offset-2 hover:underline"
            onClick={onClose}
          >
            {closeLabel}
          </button>
        </div>
      </div>
      {error && <p role="status" className="mt-2 text-xs text-destructive">{error}</p>}
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

  const qr189 = useCloudQr(window.yudu.cloud.qr, qr189Open, async () => {
    onStatus(await window.yudu.cloud.status())
    setQr189Open(false)
  })
  const qr115 = useCloudQr(window.yudu.cloud115.qr, qr115Open, async () => {
    onStatus115(await window.yudu.cloud115.status())
    setQr115Open(false)
  })

  // 卡片上只取容量数字（轻接口），目录列表等点进网盘才加载
  const { data: capacity } = useAsync(
    () => (status.loggedIn ? window.yudu.cloud.capacity(undefined) : Promise.resolve(null)),
    [status.loggedIn]
  )
  const { data: capacity115 } = useAsync(
    () => (status115.loggedIn ? window.yudu.cloud115.capacity() : Promise.resolve(null)),
    [status115.loggedIn]
  )
  const { data: mounts } = useAsync<MountRow[]>(() => window.yudu.libraries.list(), [])
  const cloud189Mounts = (mounts ?? []).filter((m) => m.kind === 'cloud189')
  const mounts115 = (mounts ?? []).filter((m) => m.kind === '115')

  const login = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      onStatus(await window.yudu.cloud.login(username, password))
      setPassword('')
      setShowLogin(false)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-8">
      <CloudHeader />

      {/* 已连接 / 待连接的网盘 */}
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              天翼云盘
              <KindBadge kind="cloud189" />
            </span>
          }
          action={
            status.loggedIn ? (
              <Button size="sm" onClick={onEnterCloud189}>
                进入
                <ChevronRight />
              </Button>
            ) : undefined
          }
        />
        <CardBody>
          <DriveCardRow
            username={status.username}
            loggedIn={status.loggedIn}
            mountCount={cloud189Mounts.length}
            capacity={capacity}
            capacityLabel="个人云空间"
          />
          {!status.loggedIn && (
            <div className="flex shrink-0 justify-end gap-2">
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
              loading={qr189.loading}
              onRefresh={qr189.refresh}
              onClose={() => setQr189Open(false)}
              closeLabel="收起，改用密码登录"
            />
          )}

          {showLogin && !status.loggedIn && (
            <form
              className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row"
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
          {error && <p className="text-xs text-destructive">{error}</p>}
          {showLogin && !status.loggedIn && (
            <p className="text-xs text-muted-foreground">凭据只保存在本机（系统级加密）</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              115 网盘
              <KindBadge kind="115" />
            </span>
          }
          action={
            status115.loggedIn ? (
              <Button size="sm" onClick={onEnter115}>
                进入
                <ChevronRight />
              </Button>
            ) : undefined
          }
        />
        <CardBody>
          <DriveCardRow
            username={status115.username}
            loggedIn={status115.loggedIn}
            mountCount={mounts115.length}
            capacity={capacity115}
            capacityLabel="云空间"
          />
          {!status115.loggedIn && (
            <div className="flex shrink-0 justify-end gap-2">
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
              loading={qr115.loading}
              onRefresh={qr115.refresh}
              onClose={() => setQr115Open(false)}
              closeLabel="收起"
            />
          )}
        </CardBody>
      </Card>

      {/* 添加网盘（多网盘架构的扩展入口） */}
      <Card>
        <CardHeader title="添加网盘" />
        <CardBody>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
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
                    if (p.id === 'webdav') {
                      document
                        .getElementById('webdav-section')
                        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                      document
                        .querySelector<HTMLInputElement>('input[aria-label="WebDAV 地址"]')
                        ?.focus({ preventScroll: true })
                    }
                  }}
                  title={connected ? '已连接' : p.available ? '连接账号' : '即将支持，敬请期待'}
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
        </CardBody>
      </Card>
    </div>
  )
}

/** 网盘卡片的状态行：图标 + 账号/挂载/容量摘要（名称与徽章在卡片头） */
function DriveCardRow({
  username,
  loggedIn,
  mountCount,
  capacity,
  capacityLabel
}: {
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
          'grid size-11 shrink-0 place-items-center rounded-lg',
          loggedIn ? 'bg-primary/10' : 'bg-muted'
        )}
      >
        <Cloud className={cn('size-5', loggedIn ? 'text-primary' : 'text-muted-foreground')} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{loggedIn ? username : '未连接'}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {loggedIn
            ? mountCount > 0
              ? `已挂载 ${mountCount} 个目录`
              : '还没有挂载目录'
            : '连接后可把云端漫画目录挂载到书架'}
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
    void window.yudu.cloud
      .capacity(fam)
      .then(setCapacity)
      .catch(() => {
        capRetry.current = setTimeout(() => {
          void window.yudu.cloud
            .capacity(fam)
            .then(setCapacity)
            .catch(() => {})
        }, 3000)
      })
  }, [])
  useEffect(
    () => () => {
      if (capRetry.current) clearTimeout(capRetry.current)
    },
    []
  )

  // 云空间、路径与内容在请求成功后一起切换，失败时仍可安全使用原目录。
  const directoryNavigation = useRef(createDirectoryNavigation<
    { stack: DirectoryPath; familyId: string }, CloudBrowseResult
  >({
    commit: (target, result) => {
      setStack(target.stack)
      setFamilyId(target.familyId)
      setBrowse(result)
    },
    error: (error) => setError(errorMessage(error)),
    busy: setBrowsing
  }))
  const browseInto = useCallback(
    (nextStack: DirectoryPath, nextFamilyId: string): void => {
      setError('')
      void directoryNavigation.current.navigate(
        { stack: nextStack, familyId: nextFamilyId },
        (target) => window.yudu.cloud.browse(
          target.stack[target.stack.length - 1]?.id,
          target.familyId || undefined
        )
      )
    },
    []
  )

  const reloadCurrent = useCallback((): void => {
    browseInto(stack, familyId)
  }, [browseInto, stack, familyId])

  useEffect(() => {
    browseInto([], '')
    return () => directoryNavigation.current.invalidate()
  }, [browseInto])

  // 容量跟随已经成功进入的空间。
  useEffect(() => {
    loadCapacity(famId)
  }, [loadCapacity, famId])

  useEffect(() => {
    void window.yudu.cloud
      .families()
      .then(setFamilies)
      .catch(() => {})
  }, [])

  const logout = async (): Promise<void> => {
    onStatus(await window.yudu.cloud.logout())
    onExit()
  }

  // 已挂载目录（含各目录的系列数）；变更后靠 bump() 刷新
  const { data: mounts } = useAsync<MountRow[]>(
    () =>
      window.yudu.libraries
        .list()
        .then((all: MountRow[]) => all.filter((m) => m.kind === 'cloud189')),
    [version]
  )
  const { data: seriesList } = useAsync<Series[]>(
    () => window.yudu.series.list({ limit: 5000 }),
    [version]
  )

  const spaceLabel = (lib: MountRow): string =>
    lib.family_id
      ? `家庭云 · ${families.find((f) => f.id === lib.family_id)?.name ?? ''}`
      : '个人云'

  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [rescanningId, setRescanningId] = useState<number | null>(null)

  // 挂载成功的轻反馈：几秒后自动消失（后续扫描进度由右上角浮标接管）
  const [mountedNotice, setMountedNotice] = useState('')
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashMountedNotice = useCallback((text: string): void => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    setMountedNotice(text)
    noticeTimer.current = setTimeout(() => setMountedNotice(''), 4000)
  }, [])
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
    },
    []
  )

  const renameMount = async (lib: MountRow, name: string): Promise<void> => {
    try {
      await window.yudu.libraries.rename(lib.id, name)
      bump()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const removeMount = async (lib: MountRow): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await window.yudu.libraries.remove(lib.id)
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
      await window.yudu.libraries.rescan(lib.id)
      bump()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setRescanningId(null)
    }
  }

  const addMount = (name: string): void => {
    setBusy(true)
    void window.yudu.cloud
      .addLibrary(current?.id ?? '-11', famId, name)
      .then(() => {
        bump()
        flashMountedNotice(`已挂载「${name}」，开始扫描…`)
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-8">
      {/* 面包屑 */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <button
          onClick={onExit}
          className="rounded px-1 py-0.5 hover:bg-accent hover:text-foreground"
        >
          网盘
        </button>
        <span className="opacity-40">/</span>
        <span className="text-foreground">天翼云盘</span>
      </div>

      {/* 网盘头 */}
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              天翼云盘
              <KindBadge kind="cloud189" />
            </span>
          }
          action={
            <Button variant="outline" size="sm" onClick={() => void logout()}>
              <LogOut />
              断开
            </Button>
          }
        />
        <CardBody>
          <div className="flex items-center gap-4">
            <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10">
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
            <SourceChip active={familyId === ''} onClick={() => browseInto([], '')} label="个人云" />
            {families.map((f) => (
              <SourceChip
                key={f.id}
                active={familyId === f.id}
                onClick={() => browseInto([], f.id)}
                label={`家庭云：${f.name}`}
              />
            ))}
          </div>
        </CardBody>
      </Card>

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
        onRename={(lib, name) => renameMount(lib, name)}
      />

      <BrowseSection
        stack={stack}
        browse={browse}
        browsing={browsing}
        error={error}
        onReload={reloadCurrent}
        onUp={() => {
          browseInto(stack.slice(0, -1), familyId)
        }}
        onRoot={() => {
          browseInto([], familyId)
        }}
        onCrumb={(_s, i) => {
          browseInto(stack.slice(0, i + 1), familyId)
        }}
        onEnter={(f) => browseInto([...stack, f], familyId)}
        addLabel={`把「${current?.name ?? '根目录'}」加入挂载`}
        defaultName={current?.name ?? (famId ? families.find((f) => f.id === famId)?.name ?? '家庭云' : '个人云')}
        onAdd={addMount}
        addBusy={busy}
      />

      {mountedNotice && <p className="text-xs text-primary">{mountedNotice}</p>}
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

  const directoryNavigation = useRef(createDirectoryNavigation<DirectoryPath, CloudBrowseResult>({
    commit: (target, result) => {
      setStack(target)
      setBrowse(result)
    },
    error: (error) => setError(errorMessage(error)),
    busy: setBrowsing
  }))
  const browseInto = useCallback((nextStack: DirectoryPath): void => {
    setError('')
    void directoryNavigation.current.navigate(
      nextStack,
      (target) => window.yudu.cloud115.browse(target[target.length - 1]?.id)
    )
  }, [])

  const reloadCurrent = useCallback((): void => {
    browseInto(stack)
  }, [browseInto, stack])

  useEffect(() => {
    browseInto([])
    void window.yudu.cloud115
      .capacity()
      .then(setCapacity)
      .catch(() => {})
    return () => directoryNavigation.current.invalidate()
  }, [browseInto])

  const logout = async (): Promise<void> => {
    onStatus(await window.yudu.cloud115.logout())
    onExit()
  }

  const { data: mounts } = useAsync<MountRow[]>(
    () =>
      window.yudu.libraries.list().then((all: MountRow[]) => all.filter((m) => m.kind === '115')),
    [version]
  )
  const { data: seriesList } = useAsync<Series[]>(
    () => window.yudu.series.list({ limit: 5000 }),
    [version]
  )

  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [rescanningId, setRescanningId] = useState<number | null>(null)

  // 挂载成功的轻反馈：几秒后自动消失（后续扫描进度由右上角浮标接管）
  const [mountedNotice, setMountedNotice] = useState('')
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashMountedNotice = useCallback((text: string): void => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    setMountedNotice(text)
    noticeTimer.current = setTimeout(() => setMountedNotice(''), 4000)
  }, [])
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
    },
    []
  )

  const renameMount = async (lib: MountRow, name: string): Promise<void> => {
    try {
      await window.yudu.libraries.rename(lib.id, name)
      bump()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const removeMount = async (lib: MountRow): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await window.yudu.libraries.remove(lib.id)
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
      await window.yudu.libraries.rescan(lib.id)
      bump()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setRescanningId(null)
    }
  }

  const addMount = (name: string): void => {
    setBusy(true)
    void window.yudu.cloud115
      .addLibrary(current?.id ?? '0', name)
      .then(() => {
        bump()
        flashMountedNotice(`已挂载「${name}」，开始扫描…`)
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-8">
      {/* 面包屑 */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <button
          onClick={onExit}
          className="rounded px-1 py-0.5 hover:bg-accent hover:text-foreground"
        >
          网盘
        </button>
        <span className="opacity-40">/</span>
        <span className="text-foreground">115 网盘</span>
      </div>

      {/* 网盘头 */}
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              115 网盘
              <KindBadge kind="115" />
            </span>
          }
          action={
            <Button variant="outline" size="sm" onClick={() => void logout()}>
              <LogOut />
              断开
            </Button>
          }
        />
        <CardBody>
          <div className="flex items-center gap-4">
            <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10">
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
        </CardBody>
      </Card>

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
        onRename={(lib, name) => renameMount(lib, name)}
      />

      <BrowseSection
        stack={stack}
        browse={browse}
        browsing={browsing}
        error={error}
        onReload={reloadCurrent}
        onUp={() => {
          browseInto(stack.slice(0, -1))
        }}
        onRoot={() => {
          browseInto([])
        }}
        onCrumb={(_s, i) => {
          browseInto(stack.slice(0, i + 1))
        }}
        onEnter={(f) => browseInto([...stack, f])}
        addLabel={`把「${current?.name ?? '根目录'}」加入挂载`}
        defaultName={current?.name ?? '根目录'}
        onAdd={addMount}
        addBusy={busy}
      />

      {mountedNotice && <p className="text-xs text-primary">{mountedNotice}</p>}
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
