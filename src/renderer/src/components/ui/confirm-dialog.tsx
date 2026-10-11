import { useId, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Dialog } from './dialog'
import { Button } from './button'
import { createConfirmation } from '@/lib/confirmation'
import { cn } from '@/lib/utils'

/** 统一确认框：先说明作用范围，取消优先；错误保留，处理中不可重复执行或关闭。 */
export function ConfirmDialog({
  title,
  description,
  details,
  confirmLabel,
  pendingLabel = '正在处理…',
  tone = 'default',
  onClose,
  onConfirm,
  fallbackFocus
}: {
  title: string
  description: ReactNode
  details?: ReactNode
  confirmLabel: string
  pendingLabel?: string
  tone?: 'danger' | 'default'
  onClose: () => void
  onConfirm: () => Promise<void>
  fallbackFocus?: () => HTMLElement | null
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const descriptionId = useId()
  const operation = useRef(createConfirmation({ busy: setBusy, error: setError }))
  const dismiss = (): void => operation.current.dismiss(onClose)
  return (
    <Dialog
      title={title}
      descriptionId={descriptionId}
      onClose={dismiss}
      closeDisabled={busy}
      fallbackFocus={fallbackFocus}
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={dismiss} data-autofocus>
            取消
          </Button>
          <Button
            variant={tone === 'danger' ? 'destructive' : 'default'}
            disabled={busy}
            onClick={() => void operation.current.confirm(onConfirm, onClose)}
          >
            {busy && <Loader2 className="animate-spin" />}
            {busy ? pendingLabel : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <span className={cn('grid size-9 shrink-0 place-items-center rounded-xl', tone === 'danger' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary')}>
            <AlertTriangle className="size-4" />
          </span>
          <div id={descriptionId} className="min-w-0 text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            {description}
          </div>
        </div>
        {details && <div className="min-w-0 rounded-xl border border-border/60 bg-muted/30 p-3 text-sm [overflow-wrap:anywhere]">{details}</div>}
        {busy && <p role="status" className="text-xs text-muted-foreground">{pendingLabel}，请稍候。</p>}
        {error && <p role="alert" className="break-words rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </div>
    </Dialog>
  )
}
