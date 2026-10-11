import { useEffect, useState, type ReactNode } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 无边框窗口的右上角控制按钮（最小化 / 最大化·还原 / 关闭），
 * 配色跟随主题，用于主界面与阅读器顶栏。
 */
export function WindowControls({ className }: { className?: string }): ReactNode {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let mounted = true
    void window.yudu.appWindow
      .isMaximized()
      .then((v) => {
        if (mounted) setMaximized(v)
      })
      .catch(() => {})
    const off = window.yudu.appWindow.onMaximizeChange((v) => setMaximized(v))
    return (): void => {
      mounted = false
      off()
    }
  }, [])

  const btn =
    'grid h-full w-11 place-items-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'

  return (
    <div
      className={cn('flex h-full shrink-0 items-stretch [-webkit-app-region:no-drag]', className)}
    >
      <button
        title="最小化"
        className={btn}
        onClick={() => {
          void window.yudu.appWindow.minimize()
        }}
      >
        <Minus className="size-4" />
      </button>
      <button
        title={maximized ? '还原' : '最大化'}
        className={btn}
        onClick={() => {
          void window.yudu.appWindow.toggleMaximize()
        }}
      >
        {maximized ? <Copy className="size-3.5" /> : <Square className="size-3.5" />}
      </button>
      <button
        title="关闭"
        className={cn(btn, 'hover:bg-destructive hover:text-white')}
        onClick={() => {
          window.yudu.appWindow.close().catch(() => {})
        }}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
