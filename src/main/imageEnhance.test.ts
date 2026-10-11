import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { enhanceImage } from './imageEnhance'

describe('可逆图像增强', () => {
  it('关闭时原样返回，开启后输出缓存且不改变原图字节', async () => {
    const source = await sharp({
      create: { width: 200, height: 300, channels: 3, background: '#aaaaaa' }
    })
      .png()
      .toBuffer()
    const original = Buffer.from(source)
    expect(await enhanceImage(source, {})).toBe(source)
    const enhanced = await enhanceImage(source, { enhance: true, contrast: 1.2, sharpness: 1 })
    expect(await enhanceImage(source, { enhance: true, contrast: 1.2, sharpness: 1 })).toBe(
      enhanced
    )
    expect(source).toEqual(original)
    expect((await sharp(enhanced).metadata()).format).toBe('webp')
    expect((await sharp(enhanced).raw().toBuffer())[0]).toBeGreaterThan(170)
  })
  it('大于处理上限的图片直接保留，不发生巨图解码错误', async () => {
    const source = await sharp({
      create: { width: 4100, height: 4100, channels: 3, background: 'white' }
    })
      .png()
      .toBuffer()
    expect(await enhanceImage(source, { enhance: true })).toBe(source)
  })
  it('裁边只影响显示副本，内容颜色保持', async () => {
    const center = await sharp({
      create: { width: 40, height: 50, channels: 3, background: '#333333' }
    })
      .png()
      .toBuffer()
    const source = await sharp({
      create: { width: 100, height: 120, channels: 3, background: 'white' }
    })
      .composite([{ input: center, left: 30, top: 35 }])
      .png()
      .toBuffer()
    const output = await enhanceImage(source, { enhance: true, autoTrim: true, sharpness: 0 })
    const info = await sharp(output).metadata()
    expect(info.width).toBe(40)
    expect(info.height).toBe(50)
    expect((await sharp(source).metadata()).width).toBe(100)
  })
  it('纯白空页与并发重复请求保持可显示，裁边不会让页面失败', async () => {
    const source = await sharp({
      create: { width: 120, height: 160, channels: 3, background: 'white' }
    })
      .png()
      .toBuffer()
    const outputs = await Promise.all(
      Array.from({ length: 6 }, () =>
        enhanceImage(source, { enhance: true, autoTrim: true, sharpness: 0 })
      )
    )
    for (const output of outputs) {
      const info = await sharp(output).metadata()
      expect(info.width).toBe(120)
      expect(info.height).toBe(160)
    }
  })
})
