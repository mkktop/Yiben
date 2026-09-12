import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * 统一弹窗壳：遮罩 bg-black/50 backdrop-blur-sm，卡片 rounded-2xl + shadow-lg +
 * scale-in 入场；标题栏与按钮区向分组卡片规范看齐（border-b/border-t + px-5 py-3.5/3）。
 * 点遮罩关闭（onClose 由调用方持有）。
 */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  className,
  closeDisabled
}: {
  title: ReactNode
  onClose: () => void
  /** 卡片主体（自带 p-5 之类的内边距由调用方安排） */
  children: ReactNode
  /** 底部按钮区；不传则不渲染分隔条 */
  footer?: ReactNode
  className?: string
  /** 关闭动作暂不可用（如删除进行中）时禁用关闭按钮并忽略遮罩点击 */
  closeDisabled?: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6 backdrop-blur-sm"
      onClick={() => !closeDisabled && onClose()}
    >
      <div
        className={cn(
          'animate-scale-in w-full max-w-md rounded-2xl border border-border/50 bg-card shadow-lg',
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-3.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-full"
            onClick={onClose}
            disabled={closeDisabled}
          >
            <X className="size-4" />
          </Button>
        </div>
        {children}
        {footer !== undefined && (
          <div className="flex justify-end gap-2 border-t border-border/60 px-5 py-3">{footer}</div>
        )}
      </div>
    </div>
  )
}
