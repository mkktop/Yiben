import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, OctagonAlert, X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToastStore, type ToastKind } from '@/stores/toast'

/**
 * 统一 Toast：右上角滑入（250ms），成功/警告/错误三态配色
 * （primary / warning / destructive），圆角条状 + 状态图标。
 * 定位与堆叠由 ToastHost 负责（各来源经 useToastStore 汇入同一竖排队列）。
 */

const KIND: Record<ToastKind, { icon: LucideIcon; chip: string; iconCls: string; border: string }> = {
  success: {
    icon: CheckCircle2,
    chip: 'bg-primary/10',
    iconCls: 'text-primary',
    border: 'border-primary/30'
  },
  warning: {
    icon: AlertTriangle,
    chip: 'bg-warning/10',
    iconCls: 'text-warning',
    border: 'border-warning/40'
  },
  error: {
    icon: OctagonAlert,
    chip: 'bg-destructive/10',
    iconCls: 'text-destructive',
    border: 'border-destructive/40'
  }
}

export type { ToastKind }

export function Toast({
  kind,
  title,
  children,
  onClose
}: {
  kind: ToastKind
  /** 首行标题（加粗主文案） */
  title: ReactNode
  /** 次行说明 / 操作入口 */
  children?: ReactNode
  onClose: () => void
}) {
  const k = KIND[kind]
  const Icon = k.icon
  return (
    <div
      className={cn(
        'animate-toast-in flex w-full items-start gap-3 rounded-xl border bg-card px-4 py-3 shadow-lg',
        k.border
      )}
    >
      <div className={cn('grid size-7 shrink-0 place-items-center rounded-lg', k.chip)}>
        <Icon className={cn('size-4', k.iconCls)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {children !== undefined && (
          <div className="mt-1 text-xs text-muted-foreground">{children}</div>
        )}
      </div>
      <button
        className="grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={onClose}
        title="关闭"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

/** 全局 Toast 宿主：右上角竖排堆叠（避开顶栏），在应用根部挂载一次 */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts)
  const close = useToastStore((s) => s.close)
  return (
    <div className="fixed right-6 top-[4.5rem] z-[60] flex w-80 flex-col gap-3">
      {toasts.map((t) => (
        <Toast key={t.id} kind={t.kind} title={t.title} onClose={() => close(t.id)}>
          {t.children}
        </Toast>
      ))}
    </div>
  )
}
