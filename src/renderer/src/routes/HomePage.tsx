import { useNavigate } from 'react-router-dom'
import { Clock, Sparkles } from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { useDataStore } from '@/stores/data'
import { CoverCard, EmptyHint } from '@/components/library/CoverGrid'
import type { ContinueItem, Series } from '@shared/types'
import { coverUrl } from '@shared/types'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return '夜深了'
  if (h < 11) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

function ContinueCard({ item }: { item: ContinueItem }) {
  const navigate = useNavigate()
  const pct = item.page_count > 0 ? Math.round(((item.read_page + 1) / item.page_count) * 100) : 0
  return (
    <button
      onClick={() => navigate(`/reader/${item.chapter_id}`)}
      className="group flex w-64 shrink-0 gap-3 rounded-xl border bg-card p-3 text-left transition-all hover:shadow-md hover:ring-1 hover:ring-primary/50"
    >
      <img
        src={coverUrl(item.series_id)}
        alt=""
        className="h-24 w-18 shrink-0 rounded-md object-cover"
        draggable={false}
      />
      <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
        <div className="min-w-0">
          <p className="line-clamp-1 text-sm font-medium">{item.series_title}</p>
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.chapter_title}</p>
        </div>
        <div>
          <div className="mb-1.5 h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            第 {item.read_page + 1} / {item.page_count} 页
          </p>
        </div>
      </div>
    </button>
  )
}

export function HomePage() {
  const version = useDataStore((s) => s.version)
  const { data: continueList } = useAsync<ContinueItem[]>(
    () => window.yiben.home.continue(),
    [version]
  )
  const { data: recent } = useAsync<Series[]>(() => window.yiben.home.recent(), [version])

  return (
    <div className="mx-auto max-w-[1400px] space-y-10 p-8">
      <header>
        <h1 className="font-serif text-2xl font-semibold">{greeting()}。</h1>
        <p className="mt-1 text-sm text-muted-foreground">继续你的阅读之旅。</p>
      </header>

      <section>
        <h2 className="mb-4 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Clock className="size-3.5" />
          继续阅读
        </h2>
        {continueList && continueList.length > 0 ? (
          <div className="flex gap-4 overflow-x-auto pb-2">
            {continueList.map((item) => (
              <ContinueCard key={item.chapter_id} item={item} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center">
            <Sparkles className="mb-3 size-7 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">还没有在读书目</p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              开始阅读后，进度会出现在这里
            </p>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">最近添加</h2>
        {recent && recent.length > 0 ? (
          <div className="grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {recent.slice(0, 12).map((s) => (
              <CoverCard key={s.id} series={s} />
            ))}
          </div>
        ) : (
          <EmptyHint>去「书架」添加本地文件夹，把漫画收进来吧</EmptyHint>
        )}
      </section>
    </div>
  )
}
