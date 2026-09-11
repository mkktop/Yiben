import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Cloud, Home, Library, Moon, Search, Settings, Sun, X } from 'lucide-react'
import { useThemeStore } from '@/stores/theme'
import { useDataStore } from '@/stores/data'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/', label: '首页', icon: Home },
  { to: '/library', label: '书架', icon: Library },
  { to: '/cloud', label: '网盘', icon: Cloud },
  { to: '/settings', label: '设置', icon: Settings }
]

export function AppShell() {
  const { mode, toggle } = useThemeStore()
  const { query, setQuery } = useDataStore()
  const navigate = useNavigate()
  const location = useLocation()
  const onLibrary = location.pathname === '/library'
  const searchRef = useRef<HTMLInputElement>(null)

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
        <div className="flex h-14 items-center gap-2.5 px-5">
          <div className="grid size-8 place-items-center rounded-lg bg-primary font-serif text-lg font-bold text-primary-foreground">
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
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
                )
              }
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-sidebar-border px-5 py-3.5">
          <span className="text-xs text-muted-foreground">v0.1.0</span>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 bg-background px-6">
          <div className="relative w-full max-w-md">
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
              className="peer h-9 rounded-full border-transparent bg-muted/60 pl-10 pr-20 shadow-sm transition-colors placeholder:text-muted-foreground/60 hover:bg-muted focus-visible:bg-background focus-visible:outline-ring/25"
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
              <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium tracking-wider text-muted-foreground/80 transition-opacity peer-focus:opacity-0">
                Ctrl K
              </kbd>
            )}
          </div>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            title="切换主题"
            className="rounded-full text-muted-foreground hover:text-foreground"
          >
            {mode === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </Button>
        </header>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
