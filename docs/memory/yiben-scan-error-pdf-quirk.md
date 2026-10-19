# scan_error 的 PDF 误报坑

> Yiben 的 chapters.scan_error 对 PDF 恒为「暂不支持的格式」（能力边界非损坏）；基于 scan_error 的功能必须排除 kind='pdf'

Yiben 扫描器对 PDF 章节列页必然抛「暂不支持的格式： pdf」并写进该章的 `scan_error`（PDF 页数由渲染进程 pdfjs 统计后回填）——这是主进程能力边界，**不代表文件损坏**。任何读取 `scan_error` 的新功能（诊断/统计/导出/批量校验）都必须排除 `kind='pdf'`，否则会把能正常打开的 PDF 误报成损坏章节。

2026-09-12 做库体检（src/main/diagnose.ts）时首版就踩了这个误报：fixture 里的正常 PDF 出现在「损坏章节」里（损坏 2 项 → 排除后 1 项）。diagnose.ts 的 brokenChapters 与 emptyChapters 现在都带 `AND c.kind != 'pdf'`，后续同类功能照做。

相关：[无头验证配方](yiben-headless-verify-recipe.md)
