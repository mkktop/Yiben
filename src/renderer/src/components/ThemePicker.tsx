import { useEffect, useRef, useState } from 'react'
import { Check, Moon, Sparkles, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { THEMES } from '@/lib/themes'
import { cn } from '@/lib/utils'
import { useThemeStore } from '@/stores/theme'

/** 顶栏直接选主题；支持方向键、Esc 和点击外部关闭。 */
export function ThemePicker() {
  const { theme, setTheme } = useThemeStore()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const choices = useRef<Array<HTMLButtonElement | null>>([])
  const current = THEMES.find((item) => item.key === theme)!
  const Icon = current.icon === 'sun' ? Sun : current.icon === 'moon' ? Moon : Sparkles

  useEffect(() => {
    if (!open) return
    choices.current[THEMES.findIndex((item) => item.key === theme)]?.focus()
    const onPointer = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
    // 选中后关闭，打开时才移动焦点。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <div ref={root} className="relative [-webkit-app-region:no-drag]" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
    }} onKeyDown={(event) => {
      if (open && event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        trigger.current?.focus()
      }
    }}>
      <Button ref={trigger} variant="ghost" size="icon" onClick={() => setOpen(!open)}
        aria-label={`选择主题，当前为${current.label}`} aria-haspopup="menu" aria-expanded={open}
        title={`主题：${current.label}`} className="mr-1 rounded-full text-muted-foreground hover:text-foreground">
        <Icon className="size-5" />
      </Button>
      {open && (
        <div role="menu" aria-label="选择主题" className="absolute top-full right-0 z-50 mt-2 w-64 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg">
          <p className="px-3 pt-2 pb-1.5 text-xs text-muted-foreground">选择主题</p>
          {THEMES.map((item, index) => {
            const ItemIcon = item.icon === 'sun' ? Sun : item.icon === 'moon' ? Moon : Sparkles
            return (
              <button type="button" key={item.key} role="menuitemradio" aria-checked={item.key === theme}
                ref={(element) => { choices.current[index] = element }} tabIndex={-1}
                onClick={() => { setTheme(item.key); setOpen(false); trigger.current?.focus() }}
                onKeyDown={(event) => {
                  let next = index
                  if (event.key === 'ArrowDown') next = (index + 1) % THEMES.length
                  else if (event.key === 'ArrowUp') next = (index + THEMES.length - 1) % THEMES.length
                  else if (event.key === 'Home') next = 0
                  else if (event.key === 'End') next = THEMES.length - 1
                  else return
                  event.preventDefault()
                  choices.current[next]?.focus()
                }}
                className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left focus-visible:bg-accent focus-visible:outline-none hover:bg-accent', theme === item.key && 'bg-accent/60')}>
                <ItemIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1"><span className="block text-sm font-medium">{item.label}</span><span className="block text-xs text-muted-foreground">{item.tone}</span></span>
                {theme === item.key && <Check className="size-4 text-primary" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
