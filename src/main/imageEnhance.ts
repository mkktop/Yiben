import sharp from 'sharp'
import { createHash } from 'crypto'
import type { ReaderPrefs } from '../shared/types'

const cache = new Map<string, Buffer>()
let bytes = 0
let active = 0
const waiters: Array<() => void> = []
const bound = (value: number | undefined, fallback: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value!)) : fallback
export async function enhanceImage(source: Buffer, prefs: ReaderPrefs): Promise<Buffer> {
  if (!prefs.enhance) return source
  const sharpness = bound(prefs.sharpness, 1, 0, 3)
  const contrast = bound(prefs.contrast, 1, 0.5, 1.5)
  const key = createHash('sha256')
    .update(source)
    .update(JSON.stringify([sharpness, contrast, Boolean(prefs.autoTrim)]))
    .digest('hex')
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  while (active >= 2) await new Promise<void>((resolve) => waiters.push(resolve))
  active++
  try {
    const metadata = await sharp(source, { limitInputPixels: false }).metadata()
    if ((metadata.width ?? 0) > 4000 || (metadata.height ?? 0) > 4000 || (metadata.pages ?? 1) > 1)
      return source
    const render = (trim: boolean): Promise<Buffer> => {
      const image = sharp(source, { limitInputPixels: 16_000_000 })
      if (trim) image.trim({ background: '#ffffff', threshold: 12 })
      if (sharpness > 0) image.sharpen({ sigma: sharpness })
      if (contrast !== 1) image.linear(contrast, 128 * (1 - contrast))
      return image.webp({ quality: 92 }).toBuffer()
    }
    // 纯白空页可能没有可裁区域，保留其尺寸继续增强，不能变成加载失败。
    const output = await render(Boolean(prefs.autoTrim)).catch((error) => {
      if (!prefs.autoTrim) throw error
      return render(false)
    })
    bytes -= cache.get(key)?.length ?? 0
    cache.set(key, output)
    bytes += output.length
    while (bytes > 64 * 1024 * 1024 || cache.size > 32) {
      const first = cache.keys().next().value!
      bytes -= cache.get(first)!.length
      cache.delete(first)
    }
    return output
  } finally {
    active--
    waiters.shift()?.()
  }
}
