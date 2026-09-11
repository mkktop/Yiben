import { useEffect, useState, type ReactNode } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 无边框窗口的右上角控制按钮（最小化 / 最大化·还原 / 关闭）。
 * app 配色用于主界面顶栏（跟随主题），overlay 用于阅读器深色渐变顶栏（白色图标）。
 */
export function WindowControls({
  variant = 'app',
  className
}: {
  variant?: 'app' | 'overlay'
  className?: string
}): ReactNode {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let mounted = true
    void window.yiben.appWindow
      .isMaximized()
      .then((v) => {
        if (mounted) setMaximized(v)
      })
      .catch(() => {})
    const off = window.yiben.appWindow.onMaximizeChange((v) => setMaximized(v))
    return (): void => {
      mounted = false
      off()
    }
  }, [])

  const btn = cn(
    'grid h-full w-11 place-items-center transition-colors',
    variant === 'app'
      ? 'text-muted-foreground hover:bg-foreground/10 hover:text-foreground'
      : 'text-white/85 hover:bg-white/15 hover:text-white'
  )

  return (
    <div
      className={cn('flex h-full shrink-0 items-stretch [-webkit-app-region:no-drag]', className)}
    >
      <button
        title="最小化"
        className={btn}
        onClick={() => {
          void window.yiben.appWindow.minimize()
        }}
      >
        <Minus className="size-4" />
      </button>
      <button
        title={maximized ? '还原' : '最大化'}
        className={btn}
        onClick={() => {
          void window.yiben.appWindow.toggleMaximize()
        }}
      >
        {maximized ? <Copy className="size-3.5" /> : <Square className="size-3.5" />}
      </button>
      <button
        title="关闭"
        className={cn(btn, 'hover:bg-red-500 hover:text-white')}
        onClick={() => {
          window.yiben.appWindow.close().catch(() => {})
        }}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
