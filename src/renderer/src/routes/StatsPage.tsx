import { useMemo } from 'react'
import { Flame, Layers, CalendarCheck, TrendingUp } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/** 主进程 stats:overview 的返回（与 preload 声明一致） */
interface StatsOverview {
  totalMinutes: number
  days: Array<{ day: string; pages: number }>
  streak: number
  totalPages: number
  totalDays: number
  bestDay: { day: string; pages: number } | null
}

/** 本地时区 YYYY-MM-DD（与主进程埋点同源，字符串比较即日期比较） */
function dayKey(d: Date): string {
  return d.toLocaleDateString('sv')
}

/** 5 档色阶：0 页空底，页数越多 primary 越实（最高档用主色渐变） */
function heatLevel(pages: number): string {
  if (pages <= 0) return 'bg-muted'
  if (pages < 10) return 'bg-primary/25'
  if (pages < 30) return 'bg-primary/45'
  if (pages < 60) return 'bg-primary/70'
  return 'bg-gradient-to-br from-primary to-primary/85'
}

interface StatCardProps {
  label: string
  value: string
  hint: string
  icon: LucideIcon
}

function StatCard({ label, value, hint, icon: Icon }: StatCardProps) {
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10">
          <Icon className="size-4 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>
    </Card>
  )
}

/** 阅读统计页：指标卡 + GitHub 风格年度热力图（53 周 × 7 天的纯 CSS grid） */
export function StatsPage() {
  const { data, error } = useAsync<StatsOverview>(() => window.yudu.stats.overview(365), [])

  // 53 列（周）× 7 行（周日..周六），最后一列对齐到本周；未到来的日子留空
  const cells = useMemo(() => {
    const pagesByDay = new Map((data?.days ?? []).map((d) => [d.day, d.pages]))
    const today = dayKey(new Date())
    const end = new Date()
    end.setDate(end.getDate() + (6 - end.getDay()))
    const start = new Date(end)
    start.setDate(start.getDate() - (53 * 7 - 1))
    const out: Array<{ key: string; pages: number; future: boolean }> = []
    for (let i = 0; i < 53 * 7; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      const key = dayKey(d)
      out.push({ key, pages: pagesByDay.get(key) ?? 0, future: key > today })
    }
    return out
  }, [data])

  if (error) {
    return (
      <div className="mx-auto max-w-[1200px] space-y-6 p-8">
        <StatsHeader />
        <Card className="p-5">
          <p className="text-sm text-muted-foreground">统计加载失败：{error}</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-8">
      <StatsHeader />

      {!data ? (
        <>
          {/* 加载态：四张卡 + 热力图骨架 */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-36 rounded-xl" />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="连续阅读"
              value={`${data.streak} 天`}
              hint={data.streak > 0 ? '今天或昨天仍在读，别断了' : '今天翻几页接上吧'}
              icon={Flame}
            />
            <StatCard
              label="累计页数"
              value={data.totalPages.toLocaleString()}
              hint="近一年读过的漫画页数"
              icon={Layers}
            />
            <StatCard
              label="阅读天数"
              value={`${data.totalDays} 天`}
              hint="近一年有阅读记录的天数"
              icon={CalendarCheck}
            />
            <StatCard
              label="最佳单日"
              value={data.bestDay ? `${data.bestDay.pages} 页` : '—'}
              hint={data.bestDay?.day ?? '还没有阅读记录'}
              icon={TrendingUp}
            />
          </div>

          <Card>
            <p className="px-5 pt-4 text-sm text-muted-foreground">
              活跃阅读时长：{Math.round(data.totalMinutes)} 分钟（失焦、后台或一分钟无操作暂停）
            </p>
            <CardHeader
              title={
                <>
                  阅读热力图
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    近一年每天的阅读页数
                  </span>
                </>
              }
            />
            <CardBody>
              <div className="overflow-x-auto pb-1">
                {/* auto-cols-fr：53 个隐式列平分容器宽度，窄窗口时才出横向滚动 */}
                <div className="grid w-full min-w-[640px] auto-cols-fr grid-flow-col grid-rows-7 gap-1">
                  {cells.map(({ key, pages, future }) => (
                    <div
                      key={key}
                      title={future ? undefined : `${key} · ${pages} 页`}
                      className={cn(
                        'aspect-square w-full rounded-[4px]',
                        future ? 'bg-muted/30' : heatLevel(pages)
                      )}
                    />
                  ))}
                </div>
              </div>
              {/* 色阶图例 */}
              <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                少
                {[
                  'bg-muted',
                  'bg-primary/25',
                  'bg-primary/45',
                  'bg-primary/70',
                  'bg-gradient-to-br from-primary to-primary/85'
                ].map((c) => (
                  <span key={c} className={cn('size-3 rounded-[4px]', c)} />
                ))}
                多
              </div>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}

function StatsHeader() {
  return (
    <header>
      <h1 className="font-serif text-2xl font-semibold">统计</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        看看自己的阅读节奏——连续多少天、哪天读得最猛
      </p>
    </header>
  )
}
