import { describe, expect, it } from 'vitest'
import { cleanNotes, htmlToText, newerVersion, normalizeNotes, sliceNotes } from './updateNotes'

describe('newerVersion', () => {
  it('按主/次/修订号比较', () => {
    expect(newerVersion('0.1.2', '0.1.1')).toBe(true)
    expect(newerVersion('0.2.0', '0.1.9')).toBe(true)
    expect(newerVersion('1.0.0', '0.9.9')).toBe(true)
    expect(newerVersion('0.1.1', '0.1.1')).toBe(false)
    // 远端更旧绝不能提示可更新（否则成了降级安装）
    expect(newerVersion('0.1.0', '0.1.1')).toBe(false)
  })

  it('版本号前缀 v 与缺段都能容忍', () => {
    expect(newerVersion('v0.1.2', '0.1.1')).toBe(true)
    expect(newerVersion('0.2', '0.1.9')).toBe(true)
  })

  it('预发布段：同号预发布 < 正式版，预发布之间按段比较', () => {
    expect(newerVersion('0.2.0-preview.1', '0.1.9')).toBe(true)
    expect(newerVersion('0.2.0', '0.2.0-preview.9')).toBe(true)
    expect(newerVersion('0.2.0-preview.2', '0.2.0-preview.1')).toBe(true)
    expect(newerVersion('0.2.0-preview.1', '0.2.0-preview.2')).toBe(false)
    // 数字段 < 字母段（semver 规则：preview.10 > preview.9，alpha < beta）
    expect(newerVersion('0.2.0-preview.10', '0.2.0-preview.9')).toBe(true)
    expect(newerVersion('0.2.0-beta', '0.2.0-alpha')).toBe(true)
  })
})

describe('sliceNotes', () => {
  const notes = ['## v0.1.0', '首个版本。', '', '## v0.1.1', '- 修复翻页', '- 新增搜索', '', '## v0.1.2', '后续'].join('\n')

  it('只取目标版本那一节', () => {
    expect(sliceNotes(notes, '0.1.1')).toBe('- 修复翻页\n- 新增搜索')
  })

  it('v0.1.1 不会误命中 v0.1.10 开头的节', () => {
    const tricky = '## v0.1.10\n另一节\n\n## v0.1.1\n目标节'
    expect(sliceNotes(tricky, '0.1.1')).toBe('目标节')
  })

  it('找不到分节时退回全文', () => {
    expect(sliceNotes('没有分节的正文', '0.1.1')).toBe('没有分节的正文')
  })
})

describe('htmlToText / cleanNotes', () => {
  it('块级标签转行、列表加破折号、实体解码', () => {
    const html = '<h1>更新说明</h1><ul><li>修复 <b>翻页</b></li><li>新增 &quot;搜索&quot;</li></ul><p>&amp; more</p>'
    expect(htmlToText(html)).toBe('更新说明\n- 修复 翻页\n- 新增 "搜索"\n\n& more')
  })

  it('cleanNotes 去掉标题/版本号行，只留正文', () => {
    const html = '<h1>更新说明</h1><h2>v0.1.1</h2><ul><li>修复翻页</li></ul>'
    expect(cleanNotes(html, '0.1.1')).toBe('- 修复翻页')
  })

  it('markdown 正文按版本分节', () => {
    expect(cleanNotes('## v0.1.0\n旧\n\n## v0.1.1\n新内容', '0.1.1')).toBe('新内容')
  })

  it('normalizeNotes 兼容字符串与 {note} 数组两种形态', () => {
    expect(normalizeNotes('  abc ')).toBe('abc')
    expect(normalizeNotes([{ note: 'a' }, { note: 'b' }])).toBe('a\nb')
    expect(normalizeNotes(null)).toBe('')
  })
})
