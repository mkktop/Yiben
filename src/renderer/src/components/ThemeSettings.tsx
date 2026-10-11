import { useRef } from 'react'
import { Check, Moon, Sparkles, Sun } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { THEMES, nextTheme } from '@/lib/themes'
import { cn } from '@/lib/utils'
import { useThemeStore } from '@/stores/theme'

/** 用相同设计令牌预览书架，让未选中的主题也保留自己的明暗与颜色。 */
export function ThemePreview({ theme }: { theme: (typeof THEMES)[number]['key'] }) {
  return (
    <div className="theme-preview" data-theme={theme} aria-hidden="true">
      <div className="theme-preview-sidebar">
        <span className="theme-preview-logo">雨</span>
        <span className="theme-preview-nav is-active" />
        <span className="theme-preview-nav" />
        <span className="theme-preview-nav" />
      </div>
      <div className="theme-preview-main">
        <div className="theme-preview-header"><span /><i /></div>
        <div className="theme-preview-content">
          <div className="theme-preview-heading"><span>我的书架</span><i /></div>
          <div className="theme-preview-books">
            {[0, 1, 2].map((index) => (
              <div key={index} className={`theme-preview-book book-${index}`}>
                <span /><i />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function ThemeSettings() {
  const { theme, setTheme } = useThemeStore()
  const options = useRef<Array<HTMLButtonElement | null>>([])
  const current = THEMES.find((item) => item.key === theme)!
  return (
    <Card>
      <CardHeader title="外观" action={<span className="text-xs text-muted-foreground">当前 · {current.label}</span>} />
      <CardBody>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium" id="theme-label">选择主题</p>
          <p className="text-xs text-muted-foreground">点击立即应用，自动记住你的选择</p>
        </div>
        <div role="radiogroup" aria-labelledby="theme-label" className="grid grid-cols-3 gap-3 xl:gap-4">
          {THEMES.map((item, index) => {
            const selected = theme === item.key
            const Icon = item.icon === 'sun' ? Sun : item.icon === 'moon' ? Moon : Sparkles
            return (
              <button
                type="button"
                key={item.key}
                ref={(element) => { options.current[index] = element }}
                role="radio"
                aria-checked={selected}
                aria-label={`${item.label}，${item.tone}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setTheme(item.key)}
                onKeyDown={(event) => {
                  let next = item.key as (typeof THEMES)[number]['key']
                  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = nextTheme(item.key)
                  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = nextTheme(item.key, -1)
                  else if (event.key === 'Home') next = THEMES[0].key
                  else if (event.key === 'End') next = THEMES[THEMES.length - 1].key
                  else return
                  event.preventDefault()
                  setTheme(next)
                  options.current[THEMES.findIndex((choice) => choice.key === next)]?.focus()
                }}
                className={cn(
                  'group relative min-w-0 overflow-hidden rounded-xl border p-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring',
                  selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-ring/60 hover:bg-accent/30'
                )}
              >
                <ThemePreview theme={item.key} />
                <div className="px-1 pt-3 pb-1">
                  <div className="flex items-center gap-2">
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm font-semibold">{item.label}</span>
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{item.tone}</span>
                    <span className={cn('ml-auto grid size-5 shrink-0 place-items-center rounded-full border', selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
                      {selected && <Check className="size-3" />}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{item.desc}</p>
                </div>
              </button>
            )
          })}
        </div>
      </CardBody>
    </Card>
  )
}
