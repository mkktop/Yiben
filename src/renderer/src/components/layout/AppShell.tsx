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
  { to: '/cloud', label: '天翼云盘', icon: Cloud },
  { to: '/settings', label: '设置', icon: Settings }
]

export function AppShell() {
  const { mode, toggle } = useThemeStore()
  const { query, setQuery } = useDataStore()
  const navigate = useNavigate()
  const location = useLocation()
  const onLibrary = location.pathname === '/library'

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

        <div className="flex items-center justify-between border-t border-sidebar-border px-4 py-3">
          <span className="text-xs text-muted-foreground">v0.1.0</span>
          <Button variant="ghost" size="icon" onClick={toggle} title="切换主题">
            {mode === 'dark' ? <Sun /> : <Moon />}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center border-b px-6">
          <div className="relative w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !onLibrary) navigate('/library')
              }}
              placeholder="搜索书架，回车查看结果…"
              className="bg-muted/50 pl-9"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
