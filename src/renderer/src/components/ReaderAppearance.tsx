import { Eye, Sparkles } from 'lucide-react'
import type { ReaderPrefs } from '@shared/types'
import { cn } from '@/lib/utils'

export function ReaderAppearance({
  prefs,
  onChange,
  allowImages = true,
  showShortcut = false
}: {
  prefs: ReaderPrefs
  onChange: (prefs: ReaderPrefs) => void
  allowImages?: boolean
  showShortcut?: boolean
}) {
  return (
    <div className="space-y-4 text-sm">
      <section className="rounded-xl border border-border/60 bg-muted/20 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Eye className="size-4 text-primary" />
          <h3 className="font-medium">阅读画面</h3>
        </div>
        <div className="space-y-3">
          <Range
            label="阅读亮度"
            value={prefs.brightness ?? 1}
            min={0.3}
            max={1.2}
            step={0.05}
            format={(value) => `${Math.round(value * 100)}%`}
            change={(value) => onChange({ brightness: value })}
          />
          <Range
            label="暖色滤镜"
            value={prefs.warmth ?? 0}
            min={0}
            max={0.6}
            step={0.05}
            format={(value) => `${Math.round(value * 100)}%`}
            change={(value) => onChange({ warmth: value })}
          />
          <SwitchRow
            label="定时暖色"
            description="仅在 20:00–次日 07:00 应用暖色滤镜"
            checked={prefs.eyeSchedule ?? false}
            change={(value) => onChange({ eyeSchedule: value })}
          />
        </div>
      </section>
      {allowImages && (
        <section className="rounded-xl border border-border/60 bg-muted/20 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <h3 className="font-medium">图像增强</h3>
            {showShortcut && (
              <kbd className="ml-auto rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">E</kbd>
            )}
          </div>
          <div className="space-y-3">
            <SwitchRow
              label="启用图像增强"
              description="处理显示副本，保留原文件"
              checked={prefs.enhance ?? false}
              change={(value) => onChange({ enhance: value })}
            />
            <div className={cn('space-y-3 border-t border-border/50 pt-3', !prefs.enhance && 'opacity-50')}>
              <Range
                disabled={!prefs.enhance}
                label="锐化"
                value={prefs.sharpness ?? 1}
                min={0}
                max={3}
                step={0.1}
                format={(value) => value.toFixed(1)}
                change={(value) => onChange({ sharpness: value })}
              />
              <Range
                disabled={!prefs.enhance}
                label="对比度"
                value={prefs.contrast ?? 1}
                min={0.5}
                max={1.5}
                step={0.05}
                format={(value) => `${value.toFixed(2)}×`}
                change={(value) => onChange({ contrast: value })}
              />
              <SwitchRow
                label="自动裁白边"
                checked={prefs.autoTrim ?? false}
                disabled={!prefs.enhance}
                change={(value) => onChange({ autoTrim: value })}
              />
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function SwitchRow({
  label,
  description,
  checked,
  disabled = false,
  change
}: {
  label: string
  description?: string
  checked: boolean
  disabled?: boolean
  change: (checked: boolean) => void
}) {
  return (
    <label className={cn('flex min-h-9 items-center justify-between gap-3', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
      <span>
        <span className="block text-sm">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>}
      </span>
      <span className="relative h-6 w-11 shrink-0">
        <input
          type="checkbox"
          className="peer absolute inset-0 z-10 m-0 size-full cursor-inherit opacity-0"
          checked={checked}
          disabled={disabled}
          aria-label={label}
          onChange={(event) => change(event.target.checked)}
        />
        <span aria-hidden className="absolute inset-0 rounded-full border border-border/70 bg-muted transition-colors peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring" />
        <span aria-hidden className="absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  )
}

function Range({
  label,
  value,
  min,
  max,
  step,
  format,
  change,
  disabled = false
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (value: number) => string
  change: (value: number) => void
  disabled?: boolean
}) {
  return (
    <label className="flex min-h-9 items-center gap-3">
      <span className="w-16 shrink-0 text-xs">{label}</span>
      <input
        aria-label={label}
        aria-valuetext={format(value)}
        disabled={disabled}
        className="h-6 min-w-0 flex-1 cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => change(Number(event.target.value))}
      />
      <span className="w-12 shrink-0 rounded-md bg-background/70 px-1.5 py-1 text-right text-xs tabular-nums text-muted-foreground">{format(value)}</span>
    </label>
  )
}
