import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { path7za } from '7zip-bin'
import { EpubDriver } from './epub'

let dir = ''
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'yudu-epub-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function put(rel: string, content: string): void {
  const p = join(dir, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, content)
}

/** 用 7za 以 zip 格式打包目录内容为 .epub（EPUB 容器就是 zip） */
function pack(name: string, ...entries: string[]): string {
  const out = join(dir, name)
  execFileSync(path7za, ['a', '-tzip', out, ...entries], { cwd: dir, stdio: 'ignore' })
  return out
}

const CONTAINER_XML = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`

const OPF = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata/>
  <manifest>
    <item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="p1" href="text/p1.xhtml" media-type="application/xhtml+xml"/>
    <item id="p2" href="text/p2.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="text/nav.xhtml" media-type="application/xhtml+xml"/>
    <item id="direct" href="images/direct.jpg" media-type="image/jpeg"/>
  </manifest>
  <spine>
    <itemref idref="cover"/>
    <itemref idref="p1"/>
    <itemref idref="direct"/>
    <itemref idref="p2"/>
  </spine>
</package>`

describe('EpubDriver 标准 EPUB', () => {
  it('按 spine 顺序取页：xhtml 引图（含 %20 编码与 ../）+ 直接图片项', async () => {
    put(
      'META-INF/container.xml',
      CONTAINER_XML.replace('OEBPS/content.opf', 'OEBPS/content.opf')
    )
    put('OEBPS/content.opf', OPF)
    // %20 编码 + ../ 相对路径
    put('OEBPS/text/cover.xhtml', `<html><body><img src="../images/cover%20art.jpg"/></body></html>`)
    // svg image（xlink:href）与 img 混排，保持文档顺序
    put(
      'OEBPS/text/p1.xhtml',
      `<html><body><svg><image xlink:href="../images/a.png"/></svg><img src="../images/b.jpg"/></body></html>`
    )
    // 引用不存在的图（跳过）与正常图并存
    put(
      'OEBPS/text/p2.xhtml',
      `<html><body><img src="missing.jpg"/><img src="../images/c.webp"/></body></html>`
    )
    put('OEBPS/text/nav.xhtml', `<html><body><nav epub:type="toc"/></body></html>`)
    put('OEBPS/images/cover art.jpg', 'COVER-BYTES')
    put('OEBPS/images/a.png', 'A')
    put('OEBPS/images/b.jpg', 'B')
    put('OEBPS/images/c.webp', 'C')
    put('OEBPS/images/direct.jpg', 'DIRECT')
    put('OEBPS/images/unused.jpg', 'NOT-IN-SPINE')
    const file = pack('std.epub', 'META-INF', 'OEBPS')

    const driver = await EpubDriver.create(file)
    const pages = await driver.listPages()
    expect(pages.map((p) => p.name)).toEqual([
      'OEBPS/images/cover art.jpg',
      'OEBPS/images/a.png',
      'OEBPS/images/b.jpg',
      'OEBPS/images/direct.jpg',
      'OEBPS/images/c.webp'
    ])
    expect((await driver.readPage(0)).toString()).toBe('COVER-BYTES')
    expect((await driver.readPage(3)).toString()).toBe('DIRECT')
    await driver.close()
  })
})

describe('EpubDriver 兜底', () => {
  it('缺 container.xml 的非标准 EPUB → 包内全部图片自然排序', async () => {
    put('loose/images/10.jpg', 'ten')
    put('loose/images/2.jpg', 'two')
    put('loose/readme.txt', 'ignore')
    const file = pack('loose.epub', 'loose')

    const driver = await EpubDriver.create(file)
    const pages = await driver.listPages()
    expect(pages.map((p) => p.name)).toEqual(['loose/images/2.jpg', 'loose/images/10.jpg'])
    expect((await driver.readPage(0)).toString()).toBe('two')
    await driver.close()
  })

  it('xhtml 中 img/image 交替时严格保持出现顺序', async () => {
    put(
      'alt/META-INF/container.xml',
      CONTAINER_XML.replace('OEBPS/content.opf', 'content.opf')
    )
    put(
      'alt/content.opf',
      `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <manifest>
    <item id="p" href="p.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="p"/></spine>
</package>`
    )
    put(
      'alt/p.xhtml',
      `<html><body><img src="i1.jpg"/><image xlink:href="i2.png"/><img src="i3.jpg"/></body></html>`
    )
    put('alt/i1.jpg', '1')
    put('alt/i2.png', '2')
    put('alt/i3.jpg', '3')
    const file = pack('alt.epub', 'alt')

    const driver = await EpubDriver.create(file)
    const pages = await driver.listPages()
    expect(pages.map((p) => p.name)).toEqual(['alt/i1.jpg', 'alt/i2.png', 'alt/i3.jpg'])
    await driver.close()
  })
})
