import { useEffect, useState, type ReactNode } from 'react'
import { useReaderStore } from '@/stores/reader'
export function ReadingSurface({ children }: { children: ReactNode }) {
  const brightness = useReaderStore((state) => state.brightness)
  const warmth = useReaderStore((state) => state.warmth)
  const schedule = useReaderStore((state) => state.eyeSchedule)
  const [hour, setHour] = useState(new Date().getHours())
  useEffect(() => {
    const timer = setInterval(() => setHour(new Date().getHours()), 60000)
    return () => clearInterval(timer)
  }, [])
  const warm = schedule && hour >= 7 && hour < 20 ? 0 : warmth
  return (
    <div className="absolute inset-0">
      <div
        data-reading-surface
        className="h-full"
        style={{ filter: brightness === 1 ? undefined : `brightness(${brightness})` }}
      >
        {children}
      </div>
      {warm > 0 && (
        <div
          data-eye-overlay
          className="pointer-events-none absolute inset-0 z-10"
          style={{ background: '#ffad60', opacity: warm, mixBlendMode: 'multiply' }}
        />
      )}
    </div>
  )
}
