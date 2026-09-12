import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { BarChart3, Cloud, Home, Library, Moon, Search, Settings, Sun, X } from 'lucide-react'
import { useThemeStore } from '@/stores/theme'
import { useDataStore } from '@/stores/data'
import { useUpdateStore } from '@/stores/update'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { WindowControls } from '@/components/layout/WindowControls'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/', label: '首页', icon: Home },
  { to: '/library', label: '书架', icon: Library },
  { to: '/cloud', label: '网盘', icon: Cloud },
  { to: '/stats', label: '统计', icon: BarChart3 },
  { to: '/settings', label: '设置', icon: Settings }
]

export function AppShell() {
  const { mode, toggle } = useThemeStore()
  const { query, setQuery } = useDataStore()
  const navigate = useNavigate()
  const location = useLocation()
  const onLibrary = location.pathname === '/library'
  const searchRef = useRef<HTMLInputElement>(null)
  const currentVersion = useUpdateStore((s) => s.current)
  const hasUpdate = useUpdateStore((s) => s.status === 'available' || s.ready !== '')

  // Ctrl/Cmd+K 随时呼出搜索；Esc 先清词再失焦
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex h-14 items-center gap-2.5 px-5 [-webkit-app-region:drag]">
          <div className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/85 font-serif text-lg font-bold text-primary-foreground shadow-sm transition-transform duration-150 hover:scale-105">
            一
          </div>
          <span className="font-serif text-lg font-semibold tracking-wide">一本</span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-3">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={label}
              to={to}
              className={({ isActive }) =>
                cn(
                  'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-150',
                  isActive
                    ? 'bg-sidebar-accent font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground'
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary" />
                  )}
                  <Icon className="size-4 shrink-0" />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-sidebar-border px-3 py-2.5">
          <button
            onClick={() => hasUpdate && navigate('/settings')}
            title={hasUpdate ? '发现新版本，点击前往设置页下载' : undefined}
            className={cn(
              'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors duration-150',
              hasUpdate
                ? 'text-primary hover:bg-sidebar-accent/60 hover:text-primary/80'
                : 'text-muted-foreground/80 hover:bg-sidebar-accent/60 hover:text-foreground'
            )}
          >
            {currentVersion ? `v${currentVersion}` : ''}
            {hasUpdate && (
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>
            )}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 bg-background pl-6 [-webkit-app-region:drag]">
          <div className="relative w-full max-w-md [-webkit-app-region:no-drag]">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground/70" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !onLibrary) navigate('/library')
                if (e.key === 'Escape') {
                  if (query) setQuery('')
                  else e.currentTarget.blur()
                }
              }}
              placeholder="搜索书架，回车查看结果…"
              className="peer h-9 rounded-full border-transparent bg-muted/60 pl-10 pr-20 transition placeholder:text-muted-foreground/60 hover:bg-muted focus-visible:border-transparent focus-visible:bg-background focus-visible:shadow-xs focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none"
            />
            {query ? (
              <button
                onClick={() => setQuery('')}
                title="清空搜索"
                className="absolute top-1/2 right-2.5 grid size-5.5 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded-full border border-border/50 bg-muted/30 px-1.5 py-0.5 text-[10px] font-medium tracking-wider text-muted-foreground/70 transition-opacity peer-focus:opacity-0">
                Ctrl K
              </kbd>
            )}
          </div>
          <div className="flex-1" />
          <div className="flex h-full items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              title="切换主题"
              className="mr-1 rounded-full text-muted-foreground hover:text-foreground"
            >
              {mode === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
            </Button>
            <WindowControls />
          </div>
        </header>
        <div className="relative min-h-0 flex-1">
          <main className="h-full overflow-y-auto">
            <Outlet />
          </main>
          {/* 书房顶光：--ambient 径向光晕，浅色更亮、深色更收敛 */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-60 bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,var(--ambient),transparent_70%)] opacity-35 dark:opacity-20"
          />
        </div>
      </div>
    </div>
  )
}
