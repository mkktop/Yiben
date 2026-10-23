import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, CardBody, CardHeader } from './ui/card'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { useAsync } from '@/hooks/useAsync'
import { useDataStore } from '@/stores/data'
import { errorMessage } from '@/lib/utils'
import { createDirectoryNavigation } from '@/lib/orderedInteraction'
import { BrowseSection, MountListSection, type MountRow } from './library/CloudShared'
import type { CloudBrowseResult, Library, Series } from '@shared/types'

/** 连接表单里的凭据（挂载前只留在内存，浏览与挂载请求随参数带上） */
interface DavCreds {
  url: string
  username: string
  password: string
}

type DirectoryPath = Array<{ id: string; name: string }>

/**
 * WebDAV / NAS 书库，与天翼/115 同一交互形态：
 * 连接（验证 + 列根目录）→ 浏览目录树 → 选定目录挂载（可改名）；
 * 已挂载的书库支持改名、编辑连接信息（改密码不删库，进度保留）、内联确认移除。
 */
export function WebDavSection() {
  const bump = useDataStore((s) => s.bump)
  const version = useDataStore((s) => s.version)
  const [name, setName] = useState('WebDAV 书库')
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** 连接成功后的浏览阶段；creds 为空表示还在表单阶段 */
  const [creds, setCreds] = useState<DavCreds | null>(null)
  const [stack, setStack] = useState<DirectoryPath>([])
  const [browse, setBrowse] = useState<CloudBrowseResult | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const [mountedNotice, setMountedNotice] = useState('')
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 正在编辑连接信息的书库 id */
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const [editUsername, setEditUsername] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState('')

  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [rescanningId, setRescanningId] = useState<number | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)

  const current = stack[stack.length - 1]

  const { data: libraries } = useAsync<Library[]>(() => window.yudu.libraries.list(), [version])
  const { data: seriesList } = useAsync<Series[]>(
    () => window.yudu.series.list({ limit: 5000 }),
    [version]
  )
  const mounts = (libraries ?? []).filter((l) => l.kind === 'webdav')

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
    },
    []
  )
  const flashNotice = useCallback((text: string): void => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    setMountedNotice(text)
    noticeTimer.current = setTimeout(() => setMountedNotice(''), 4000)
  }, [])

  // 路径与内容在请求成功后一起切换，失败时仍可安全使用原目录（与天翼/115 同一导航器）
  const directoryNavigation = useRef(
    createDirectoryNavigation<{ stack: DirectoryPath }, CloudBrowseResult>({
      commit: (target, result) => {
        setStack(target.stack)
        setBrowse(result)
      },
      error: (e) => setError(errorMessage(e)),
      busy: setBrowsing
    })
  )
  const browseInto = useCallback(
    (nextStack: DirectoryPath): void => {
      if (!creds) return
      setError('')
      void directoryNavigation.current.navigate({ stack: nextStack }, (target) =>
        window.yudu.webdav.browse(creds, target.stack[target.stack.length - 1]?.id ?? 'root')
      )
    },
    [creds]
  )
  const reloadCurrent = useCallback((): void => {
    browseInto(stack)
  }, [browseInto, stack])

  /** 连接：验证地址可达并列出根目录，成功即进入浏览阶段（配置尚未落库） */
  const connect = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const result = await window.yudu.webdav.probe({ url, username, password })
      setCreds({ url, username, password })
      setStack([])
      setBrowse(result)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  /** 断开浏览：清掉内存里的凭据回到连接表单（已挂载的书库不受影响） */
  const disconnect = (): void => {
    directoryNavigation.current.invalidate()
    setCreds(null)
    setStack([])
    setBrowse(null)
    setPassword('')
    setError('')
  }

  const addMount = (mountName: string): void => {
    if (!creds) return
    setBusy(true)
    void window.yudu.webdav
      .add({ ...creds, name: mountName, rootId: current?.id })
      .then(() => {
        bump()
        flashNotice(`已挂载「${mountName}」，开始扫描…`)
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setBusy(false))
  }

  const removeMount = async (lib: MountRow): Promise<void> => {
    setRemoveBusy(true)
    setError('')
    try {
      await window.yudu.libraries.remove(lib.id)
      setConfirmId(null)
      bump()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setRemoveBusy(false)
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

  const renameMount = async (lib: MountRow, nextName: string): Promise<void> => {
    try {
      await window.yudu.libraries.rename(lib.id, nextName)
      bump()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const startEdit = (lib: MountRow): void => {
    setEditingId(lib.id)
    setEditName(lib.name)
    setEditUrl('')
    setEditUsername('')
    setEditPassword('')
    setEditError('')
  }

  const saveEdit = async (): Promise<void> => {
    if (editingId === null) return
    setEditBusy(true)
    setEditError('')
    try {
      await window.yudu.webdav.update({
        id: editingId,
        name: editName.trim() || undefined,
        url: editUrl.trim() || undefined,
        username: editUsername.trim() || undefined,
        password: editPassword || undefined
      })
      setEditingId(null)
      bump()
      flashNotice('连接信息已更新；地址或用户名变了的话，建议重扫一次对账。')
    } catch (e) {
      setEditError(errorMessage(e))
    } finally {
      setEditBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      {creds ? (
        <BrowseSection
          stack={stack}
          browse={browse}
          browsing={browsing}
          error={error}
          onReload={reloadCurrent}
          onUp={() => browseInto(stack.slice(0, -1))}
          onRoot={() => browseInto([])}
          onCrumb={(_s, i) => browseInto(stack.slice(0, i + 1))}
          onEnter={(f) => browseInto([...stack, f])}
          addLabel={`把「${current?.name ?? '根目录'}」加入挂载`}
          defaultName={current?.name ?? name}
          onAdd={addMount}
          addBusy={busy}
          onExit={{ label: '断开连接', onClick: disconnect }}
        />
      ) : (
        <Card>
          <CardHeader title="WebDAV / NAS 书库" />
          <CardBody>
            <p className="text-xs text-muted-foreground">
              输入漫画根目录的 WebDAV 地址，连接后浏览目录树、选择要挂载的文件夹；
              支持散图、压缩包、PDF 和离线缓存。凭据只保存在本机（系统级加密）。
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                aria-label="WebDAV 书库名称"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="书库名称"
              />
              <Input
                aria-label="WebDAV 地址"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://nas.example.com/dav/comics/"
              />
              <Input
                aria-label="WebDAV 用户名"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="用户名"
              />
              <Input
                aria-label="WebDAV 密码"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="密码 / 应用密码"
              />
            </div>
            <Button
              size="sm"
              disabled={busy || !url.trim() || !username || !password}
              onClick={() => void connect()}
            >
              {busy ? '连接中…' : '连接并浏览'}
            </Button>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </CardBody>
        </Card>
      )}

      <MountListSection
        mounts={mounts}
        seriesList={seriesList}
        spaceLabel={() => 'WebDAV'}
        busy={removeBusy}
        confirmId={confirmId}
        setConfirmId={setConfirmId}
        rescanningId={rescanningId}
        onRemove={(lib) => void removeMount(lib)}
        onRescan={(lib) => void rescanMount(lib)}
        onRename={(lib, nextName) => renameMount(lib, nextName)}
        onEdit={(lib) => startEdit(lib)}
      />

      {editingId !== null && (
        <Card>
          <CardHeader title="编辑连接信息" />
          <CardBody>
            <p className="text-xs text-muted-foreground">
              改密码不用删库重建，阅读进度不受影响；地址或用户名变化后重扫一次即可对账。留空表示保持不变。
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                aria-label="书库名称"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="书库名称"
              />
              <Input
                aria-label="WebDAV 地址"
                value={editUrl}
                onChange={(e) => setEditUrl(e.target.value)}
                placeholder="保持原地址"
              />
              <Input
                aria-label="用户名"
                value={editUsername}
                onChange={(e) => setEditUsername(e.target.value)}
                placeholder="保持原用户名"
              />
              <Input
                aria-label="密码"
                type="password"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                placeholder="保持原密码"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={editBusy} onClick={() => void saveEdit()}>
                {editBusy ? '验证中…' : '验证并保存'}
              </Button>
              <Button size="sm" variant="ghost" disabled={editBusy} onClick={() => setEditingId(null)}>
                取消
              </Button>
            </div>
            {editError && <p className="text-xs text-destructive">{editError}</p>}
          </CardBody>
        </Card>
      )}

      {mountedNotice && <p className="text-xs text-primary">{mountedNotice}</p>}
      {creds && error && browse && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
