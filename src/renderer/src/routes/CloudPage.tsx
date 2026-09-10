import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft,
  Cloud,
  CloudUpload,
  Folder,
  FolderPlus,
  Loader2,
  LogOut,
  RefreshCw
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDataStore } from '@/stores/data'
import { cn, errorMessage } from '@/lib/utils'
import type { CloudBrowseResult, CloudStatus } from '@shared/types'

interface Family {
  id: string
  name: string
}

function fmtGB(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(1)
}

export function CloudPage() {
  const bump = useDataStore((s) => s.bump)
  const [status, setStatus] = useState<CloudStatus | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [capacity, setCapacity] = useState<{ total: number; free: number } | null>(null)
  const [families, setFamilies] = useState<Family[]>([])
  const [familyId, setFamilyId] = useState<string>('')
  const [stack, setStack] = useState<Array<{ id: string; name: string }>>([])
  const [browse, setBrowse] = useState<CloudBrowseResult | null>(null)
  const [browsing, setBrowsing] = useState(false)

  const loadStatus = useCallback((): void => {
    void window.yiben.cloud.status().then(setStatus)
  }, [])

  useEffect(loadStatus, [loadStatus])

  const current = stack[stack.length - 1]
  const famId = familyId || undefined

  const browseInto = useCallback(
    (id: string | undefined, name: string, fam?: string): void => {
      setBrowsing(true)
      void window.yiben.cloud
        .browse(id, fam)
        .then((r) => {
          setBrowse(r)
          if (id) setStack((s) => [...s, { id, name }])
          else setStack([])
        })
        .catch((e) => setError(errorMessage(e)))
        .finally(() => setBrowsing(false))
    },
    []
  )

  // 登录后 / 切换个人云与家庭云 → 自动加载对应根目录（容量也跟随当前空间）
  useEffect(() => {
    if (!status?.loggedIn) return
    void window.yiben.cloud.capacity(famId).then(setCapacity).catch(() => {})
    void window.yiben.cloud
      .families()
      .then(setFamilies)
      .catch(() => {})
    setStack([])
    browseInto(undefined, '根目录', famId)
  }, [status?.loggedIn, familyId, browseInto])

  const login = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      setStatus(await window.yiben.cloud.login(username, password))
      setPassword('')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const logout = async (): Promise<void> => {
    setStatus(await window.yiben.cloud.logout())
    setBrowse(null)
    setStack([])
    setCapacity(null)
  }

  const addLibrary = (): void => {
    const defaultName = famId
      ? (families.find((f) => f.id === famId)?.name ?? '家庭云')
      : '个人云'
    setBusy(true)
    void window.yiben.cloud
      .addLibrary(current?.id ?? '-11', famId, current?.name ?? defaultName)
      .then(() => bump())
      .finally(() => setBusy(false))
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-8">
      <header>
        <h1 className="font-serif text-2xl font-semibold">天翼云盘</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          把云盘里的漫画目录加入书架，支持个人云与家庭云
        </p>
      </header>

      {!status ? (
        <div className="rounded-xl border p-5 text-sm text-muted-foreground">加载中…</div>
      ) : !status.loggedIn ? (
        <div className="rounded-xl border p-5">
          <div className="flex items-center gap-4">
            <div className="grid size-11 place-items-center rounded-lg bg-muted">
              <Cloud className="size-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">登录天翼云盘</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                凭据只保存在本机（系统级加密）
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
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
            <Button onClick={login} disabled={busy || !username || !password}>
              {busy ? <Loader2 className="animate-spin" /> : <CloudUpload />}
              登录
            </Button>
          </div>
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>
      ) : (
        <div className="space-y-5 rounded-xl border p-5">
          {/* 账号状态 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="grid size-11 place-items-center rounded-lg bg-primary/10">
                <Cloud className="size-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">已登录：{status.username}</p>
                {capacity && capacity.total > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    云盘空间 {fmtGB(capacity.total - capacity.free)} / {fmtGB(capacity.total)} GB
                  </p>
                )}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={logout}>
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

          {/* 云空间切换：按钮式，避免原生下拉在深色下的样式问题 */}
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

          {/* 目录浏览 */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">选择漫画所在目录</p>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => browseInto(current?.id, current?.name ?? '', famId)}
                title="刷新"
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </div>

            <div className="mb-2 flex min-h-7 items-center gap-1 text-xs text-muted-foreground">
              {stack.length > 0 && (
                <button
                  onClick={() => {
                    const next = [...stack]
                    next.pop()
                    setStack(next)
                    const parent = next[next.length - 1]
                    browseInto(parent?.id, parent?.name ?? '根目录', famId)
                  }}
                  className="grid size-6 place-items-center rounded hover:bg-accent"
                  title="上一级"
                >
                  <ArrowLeft className="size-3.5" />
                </button>
              )}
              <button
                onClick={() => {
                  setStack([])
                  browseInto(undefined, '根目录', famId)
                }}
                className="rounded px-1 hover:text-foreground"
              >
                根目录
              </button>
              {stack.map((s, i) => (
                <span key={s.id} className="flex items-center gap-1">
                  <span className="opacity-40">/</span>
                  <span className={i === stack.length - 1 ? 'text-foreground' : ''}>{s.name}</span>
                </span>
              ))}
            </div>

            <div className="max-h-64 min-h-28 overflow-y-auto rounded-lg border">
              {browsing ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                </div>
              ) : error ? (
                <p className="px-3 py-8 text-center text-xs text-destructive">{error}</p>
              ) : browse && browse.folders.length > 0 ? (
                browse.folders.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => browseInto(f.id, f.name, famId)}
                    className="flex w-full items-center gap-2 border-b border-border/60 px-3 py-2.5 text-left text-sm last:border-0 hover:bg-accent"
                  >
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{f.name}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      进入
                    </span>
                  </button>
                ))
              ) : (
                <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                  此目录没有子文件夹（含漫画压缩包时可直接加入书架）
                </p>
              )}
            </div>

            <Button
              size="sm"
              className="mt-4 w-full"
              disabled={busy || browsing}
              onClick={addLibrary}
            >
              {busy ? <Loader2 className="animate-spin" /> : <FolderPlus />}
              把「{current?.name ?? '根目录'}」加入书架
            </Button>
          </div>
        </div>
      )}
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
