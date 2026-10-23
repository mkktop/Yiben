import { useState } from 'react'
import {
  ArrowLeft,
  Check,
  FileArchive,
  Folder,
  FolderPlus,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { CloudBrowseResult, Series } from '@shared/types'

/** 挂载目录（libraries 表里的云端/WebDAV 库） */
export interface MountRow {
  id: number
  name: string
  path: string
  kind: string
  cloud_folder_id?: string | null
  family_id?: string | null
}

export function fmtSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** 网盘类型徽章：统一小圆角 chip，按类型着色（未知类型按本地兜底） */
export const KIND_BADGE: Record<string, { label: string; cls: string }> = {
  cloud189: { label: '天翼云', cls: 'bg-primary/10 text-primary' },
  '115': { label: '115', cls: 'bg-sky-500/10 text-sky-600 dark:text-sky-400' },
  webdav: { label: 'WebDAV', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  local: { label: '本地', cls: 'bg-muted text-muted-foreground' }
}

export function KindBadge({ kind }: { kind: string }) {
  const b = KIND_BADGE[kind] ?? KIND_BADGE.local!
  return (
    <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium', b.cls)}>
      {b.label}
    </span>
  )
}

/**
 * 挂载目录列表（天翼 / 115 / WebDAV 共用）：
 * 重扫、改名、移除（内联二次确认，不用 window.confirm）；
 * onEdit 存在时额外提供「编辑连接」入口（WebDAV 改凭据不删库）。
 */
export function MountListSection({
  mounts,
  seriesList,
  spaceLabel,
  busy,
  confirmId,
  setConfirmId,
  rescanningId,
  onRemove,
  onRescan,
  onRename,
  onEdit
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
  onRename?: (lib: MountRow, name: string) => Promise<void> | void
  onEdit?: (lib: MountRow) => void
}) {
  const [renaming, setRenaming] = useState<{ id: number; value: string } | null>(null)
  const [renameBusy, setRenameBusy] = useState(false)

  const seriesCount = (libraryId: number): number =>
    (seriesList ?? []).filter((s) => s.library_id === libraryId).length

  const submitRename = async (lib: MountRow): Promise<void> => {
    const name = renaming?.value.trim()
    if (!renaming || !name || !onRename) return
    setRenameBusy(true)
    try {
      await onRename(lib, name)
      setRenaming(null)
    } finally {
      setRenameBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="已挂载目录"
        action={<span className="text-xs text-muted-foreground">{mounts?.length ?? 0} 个</span>}
      />
      <CardBody>
        {(mounts ?? []).length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            还没有挂载目录，在下方浏览并添加
          </p>
        ) : (
          <div className="space-y-1">
            {(mounts ?? []).map((lib) => (
              <div
                key={lib.id}
                className="rounded-lg px-4 py-3 transition-colors hover:bg-accent/60"
              >
                <div className="flex items-center gap-3">
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    {renaming?.id === lib.id ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          autoFocus
                          className="h-7 w-52 text-sm"
                          value={renaming.value}
                          disabled={renameBusy}
                          onChange={(e) => setRenaming({ id: lib.id, value: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void submitRename(lib)
                            if (e.key === 'Escape') setRenaming(null)
                          }}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="size-7 p-0"
                          disabled={renameBusy || !renaming.value.trim()}
                          onClick={() => void submitRename(lib)}
                          title="确认改名"
                        >
                          <Check className="size-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="size-7 p-0"
                          disabled={renameBusy}
                          onClick={() => setRenaming(null)}
                          title="取消"
                        >
                          <X className="size-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <p className="flex items-center gap-2 truncate text-sm">
                          <span className="min-w-0 truncate">{lib.name}</span>
                          <KindBadge kind={lib.kind} />
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {spaceLabel(lib)} · {seriesCount(lib.id)} 部漫画
                        </p>
                      </>
                    )}
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
                        <RefreshCw
                          className={cn('size-3.5', rescanningId === lib.id && 'animate-spin')}
                        />
                        {rescanningId === lib.id ? '扫描中' : '重扫'}
                      </Button>
                      {onRename && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="size-7 p-0 text-muted-foreground"
                          disabled={busy || renameBusy}
                          onClick={() => setRenaming({ id: lib.id, value: lib.name })}
                          title="改名"
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      )}
                      {onEdit && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-muted-foreground"
                          disabled={busy || renameBusy}
                          onClick={() => onEdit(lib)}
                          title="编辑连接信息"
                        >
                          编辑
                        </Button>
                      )}
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
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

/**
 * 目录浏览（天翼 / 115 / WebDAV 共用）：
 * 已挂载的目录行带标记（主进程 browse 出口对照 libraries 计算好）；
 * 挂载动作先弹出名称输入（预填目录名），确认后才落库。
 */
export function BrowseSection({
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
  defaultName,
  onAdd,
  addBusy,
  onExit
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
  /** 挂载名称输入的预填值（当前目录名） */
  defaultName: string
  onAdd: (name: string) => void
  addBusy: boolean
  /** 退出浏览（WebDAV 连接阶段的「断开」） */
  onExit?: { label: string; onClick: () => void }
}) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState(defaultName)
  // 目录切换后重置输入内容，避免上一个目录的名字带到新目录
  const [lastDefault, setLastDefault] = useState(defaultName)
  if (defaultName !== lastDefault) {
    setLastDefault(defaultName)
    setName(defaultName)
    setNaming(false)
  }

  return (
    <Card>
      <CardHeader
        title={
          <>
            浏览目录
            <span className="ml-2 text-xs font-normal text-muted-foreground">添加新挂载</span>
          </>
        }
        action={
          <div className="flex items-center gap-1">
            {onExit && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onExit.onClick}>
                {onExit.label}
              </Button>
            )}
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
        }
      />
      <CardBody>
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
            className={cn(
              'rounded px-1 hover:text-foreground',
              stack.length === 0 && 'text-foreground'
            )}
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

        <div className="max-h-80 min-h-28 overflow-y-auto rounded-lg border p-1.5">
          {browsing ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : error && !browse ? (
            <p className="px-3 py-8 text-center text-xs text-destructive">{error}</p>
          ) : !browse || (browse.folders.length === 0 && browse.files.length === 0) ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">此目录为空</p>
          ) : (
            <>
              {browse.folders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => onEnter(f)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2.5 text-left text-sm transition-colors hover:bg-accent/60"
                >
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{f.name}</span>
                  {f.mounted && (
                    <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                      已挂载
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">进入</span>
                </button>
              ))}
              {browse.files.length > 0 && (
                <div className="mt-1 rounded-lg border bg-muted/30 px-3 py-1.5">
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

        {naming ? (
          <div className="mt-3 flex items-center gap-2">
            <Input
              autoFocus
              className="h-8 text-sm"
              value={name}
              disabled={addBusy}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim() && !addBusy && !browsing) {
                  onAdd(name.trim())
                  setNaming(false)
                }
                if (e.key === 'Escape') setNaming(false)
              }}
              placeholder="挂载名称"
            />
            <Button
              size="sm"
              disabled={addBusy || browsing || !name.trim()}
              onClick={() => {
                onAdd(name.trim())
                setNaming(false)
              }}
            >
              {addBusy ? <Loader2 className="animate-spin" /> : <FolderPlus />}
              确认挂载
            </Button>
            <Button size="sm" variant="ghost" disabled={addBusy} onClick={() => setNaming(false)}>
              取消
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            className="mt-3 w-full"
            disabled={addBusy || browsing || !browse}
            onClick={() => setNaming(true)}
          >
            <FolderPlus />
            {addLabel}
          </Button>
        )}
      </CardBody>
    </Card>
  )
}
