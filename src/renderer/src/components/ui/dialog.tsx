import { useId, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useModalFocus } from '@/lib/modalFocus'

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
  closeDisabled,
  descriptionId,
  fallbackFocus
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
  /** 可选关联主体说明，供确认类弹窗朗读操作范围。 */
  descriptionId?: string
  /** 原触发控件被删除或禁用时，关闭后恢复到明确的页面位置。 */
  fallbackFocus?: () => HTMLElement | null
}) {
  const titleId = useId()
  const focus = useModalFocus(onClose, closeDisabled, fallbackFocus)
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6 backdrop-blur-sm"
      onClick={() => !closeDisabled && onClose()}
    >
      <div
        ref={focus.ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={cn(
          'animate-scale-in max-h-[calc(100dvh-3rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-border/50 bg-card shadow-lg',
          className
        )}
        onKeyDown={focus.onKeyDown}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-3.5">
          <h2 id={titleId} className="text-sm font-semibold">
            {title}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-full"
            onClick={onClose}
            disabled={closeDisabled}
            aria-label="关闭弹窗"
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
