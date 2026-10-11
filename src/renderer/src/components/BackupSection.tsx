import { useEffect, useState } from 'react'
import { Database, Loader2, RotateCcw, ShieldCheck } from 'lucide-react'
import type { DatabaseBackup } from '@shared/types'
import { Card, CardBody, CardHeader } from './ui/card'
import { Button } from './ui/button'
import { ConfirmDialog } from './ui/confirm-dialog'
import { errorMessage } from '@/lib/utils'

function backupSize(bytes: number): string {
  return bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

function backupTime(createdAt: number): string {
  return new Date(createdAt).toLocaleString('zh-CN', { hour12: false })
}

export function BackupSection() {
  const [list, setList] = useState<DatabaseBackup[]>([])
  const [enabled, setEnabled] = useState(true)
  const [keep, setKeep] = useState(7)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [messageError, setMessageError] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<DatabaseBackup | null>(null)
  const refresh = async (): Promise<void> => {
    setList(await window.yudu.backup.list())
  }
  useEffect(() => {
    void Promise.all([
      refresh(),
      window.yudu.config.get('backupEnabled').then((value) => setEnabled(value !== false)),
      window.yudu.config.get('backupRetention').then((value) => setKeep(Number(value) || 7))
    ]).catch((error) => {
      setMessageError(true)
      setMessage(errorMessage(error))
    })
  }, [])
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setMessage('')
    setMessageError(false)
    try {
      await fn()
      await refresh()
      setMessage('操作完成')
    } catch (error) {
      setMessageError(true)
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  const restore = async (): Promise<void> => {
    if (!restoreTarget) return
    setBusy(true)
    setMessageError(false)
    setMessage('正在校验备份并保存恢复前安全快照…')
    try {
      await window.yudu.backup.restore(restoreTarget.id)
      setMessage('正在重启并恢复备份…')
    } catch (error) {
      setMessageError(true)
      setMessage(errorMessage(error))
      throw error
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <CardHeader title="数据库备份与恢复" />
      <CardBody>
        <p className="text-xs text-muted-foreground">
          保存书库记录、进度、书签、书架、标签和偏好，不复制漫画文件。启动时距上次备份满 24
          小时会自动备份；普通与恢复前备份分别保留指定份数。恢复前另存安全备份，然后重启。
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg bg-muted/35 p-3 text-sm">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={enabled}
              disabled={busy}
              onChange={(event) => {
                const value = event.target.checked
                void run(async () => {
                  await window.yudu.config.set('backupEnabled', value)
                  setEnabled(value)
                })
              }}
            />
            自动备份
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            每类保留
            <select
              aria-label="数据库备份保留数量"
              className="h-8 rounded-md border border-input bg-card px-2 text-xs text-foreground outline-none focus-visible:outline-2 focus-visible:outline-ring/60"
              value={keep}
              disabled={busy}
              onChange={(event) => {
                const value = Number(event.target.value)
                void run(async () => {
                  await window.yudu.config.set('backupRetention', value)
                  setKeep(value)
                })
              }}
            >
              {[3, 7, 14, 30].map((value) => (
                <option key={value} value={value}>
                  {value} 份
                </option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void run(() => window.yudu.backup.create())}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Database />}
            立即备份
          </Button>
        </div>
        {list.length > 0 ? (
          <div className="max-h-80 overflow-y-auto rounded-lg border">
            {list.map((entry) => (
              <div key={entry.id} data-backup-id={entry.id} className="flex items-center gap-3 border-b border-border/60 px-3 py-3 last:border-0">
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  {entry.safety ? <ShieldCheck className="size-4" /> : <Database className="size-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium tabular-nums">{backupTime(entry.createdAt)}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {entry.safety ? '恢复前安全备份' : '普通数据库备份'} · {backupSize(entry.bytes)}
                  </p>
                </div>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setRestoreTarget(entry)}>
                  <RotateCcw />
                  恢复
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">暂无数据库备份，可点击「立即备份」创建。</p>
        )}
        {message && <p role={messageError ? 'alert' : 'status'} className={`text-xs ${messageError ? 'text-destructive' : 'text-muted-foreground'}`}>{message}</p>}
      </CardBody>
      {restoreTarget && (
        <ConfirmDialog
          title="恢复数据库备份"
          description="将当前书库数据与设置替换为选中的备份内容，并重启应用。"
          details={<div className="space-y-3">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-lg bg-muted/60 p-3 text-xs">
              <dt className="text-muted-foreground">备份时间</dt>
              <dd className="tabular-nums">{backupTime(restoreTarget.createdAt)}</dd>
              <dt className="text-muted-foreground">备份大小</dt>
              <dd className="tabular-nums">{backupSize(restoreTarget.bytes)}</dd>
              <dt className="text-muted-foreground">备份类型</dt>
              <dd>{restoreTarget.safety ? '恢复前安全备份' : '普通数据库备份'}</dd>
            </dl>
            <p className="text-xs text-muted-foreground">恢复前会校验备份，并另存当前数据库的安全快照。应用随后重启，书库、阅读进度、书签和设置恢复到所选时间；漫画文件保留。</p>
          </div>}
          confirmLabel="恢复并重启"
          pendingLabel="正在校验并准备恢复…"
          tone="danger"
          onClose={() => setRestoreTarget(null)}
          onConfirm={restore}
        />
      )}
    </Card>
  )
}
