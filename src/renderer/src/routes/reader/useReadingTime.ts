import { useEffect } from 'react'
export function useReadingTime(chapterId: number, ready: boolean): void {
  useEffect(() => {
    if (!ready || chapterId <= 0) return
    let last = performance.now()
    let interaction = last
    let pending = 0
    const collect = (): void => {
      const now = performance.now()
      if (
        document.visibilityState === 'visible' &&
        document.hasFocus() &&
        now - interaction < 60000
      )
        pending += Math.min(1000, now - last)
      last = now
    }
    const flush = (): void => {
      collect()
      const ms = Math.floor(pending)
      pending = 0
      if (ms > 0) void window.yudu.stats.time(chapterId, Math.min(120000, ms)).catch(() => {})
    }
    const active = (): void => {
      collect()
      interaction = performance.now()
    }
    const visibility = (): void => {
      flush()
      last = performance.now()
    }
    const tick = setInterval(collect, 1000)
    const save = setInterval(flush, 15000)
    for (const event of ['keydown', 'pointerdown', 'wheel', 'mousemove'])
      window.addEventListener(event, active, { passive: true })
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pagehide', flush)
    window.addEventListener('blur', flush)
    return () => {
      flush()
      clearInterval(tick)
      clearInterval(save)
      for (const event of ['keydown', 'pointerdown', 'wheel', 'mousemove'])
        window.removeEventListener(event, active)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('blur', flush)
    }
  }, [chapterId, ready])
}
