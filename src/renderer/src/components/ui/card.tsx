import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * 四页（设置/统计/网盘/系列详情）统一的分组卡片规范：
 * 卡片 rounded-xl border bg-card shadow-sm；卡片头带下边框；卡片体 p-5 space-y-4。
 */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('rounded-xl border bg-card shadow-sm', className)}>{children}</section>
}

export function CardHeader({
  title,
  action,
  className
}: {
  title: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn('flex items-center justify-between gap-4 border-b border-border/60 px-5 py-3.5', className)}
    >
      <h2 className="text-sm font-semibold">{title}</h2>
      {action}
    </div>
  )
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('space-y-4 p-5', className)}>{children}</div>
}
