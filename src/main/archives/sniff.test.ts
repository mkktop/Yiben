import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { path7za } from '7zip-bin'
import { sniffArchiveKind } from './sniff'
import { getDriver } from './index'

let dir = ''
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'yudu-sniff-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** 只含魔数的假容器文件 */
function fake(name: string, magic: number[]): string {
  const p = join(dir, name)
  writeFileSync(p, Buffer.from([...magic, 0xde, 0xad, 0xbe, 0xef]))
  return p
}

const ZIP = [0x50, 0x4b, 0x03, 0x04]
const RAR = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00, 0x00]
const SEVENZ = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]

describe('sniffArchiveKind 魔数纠正', () => {
  it('伪装 .cbr（实为 zip）→ zip', async () => {
    expect(await sniffArchiveKind(fake('a.cbr', ZIP), 'rar')).toBe('zip')
  })
  it('伪装 .cbz（实为 rar）→ rar', async () => {
    expect(await sniffArchiveKind(fake('b.cbz', RAR), 'zip')).toBe('rar')
  })
  it('扩展名与魔数一致时不变', async () => {
    expect(await sniffArchiveKind(fake('c.zip', ZIP), 'zip')).toBe('zip')
    expect(await sniffArchiveKind(fake('d.pdf', PDF), 'pdf')).toBe('pdf')
    expect(await sniffArchiveKind(fake('e.7z', SEVENZ), '7z')).toBe('7z')
  })
  it('epub 本质是 zip 容器，保持 epub', async () => {
    expect(await sniffArchiveKind(fake('f.epub', ZIP), 'epub')).toBe('epub')
  })
  it('读不到头（空文件/不存在）时按扩展名', async () => {
    const empty = join(dir, 'empty.rar')
    writeFileSync(empty, Buffer.alloc(0))
    expect(await sniffArchiveKind(empty, 'rar')).toBe('rar')
    expect(await sniffArchiveKind(join(dir, 'nope.zip'), 'zip')).toBe('zip')
  })
})

describe('getDriver 嗅探兜底', () => {
  it('伪装 .cbr（实为 zip）能列出图片页', async () => {
    const sub = join(dir, 'fake-cbr')
    mkdirSync(sub)
    writeFileSync(join(sub, 'p1.png'), Buffer.from('png1'))
    writeFileSync(join(sub, 'p2.png'), Buffer.from('png2'))
    const disguised = join(dir, '第01话.cbr')
    execFileSync(path7za, ['a', '-tzip', disguised, '*.png'], { cwd: sub, stdio: 'ignore' })

    const driver = await getDriver(disguised, false)
    const pages = await driver.listPages()
    expect(pages.map((p) => p.name)).toEqual(['p1.png', 'p2.png'])
    expect((await driver.readPage(1)).toString()).toBe('png2')
    await driver.close()
  })
})
