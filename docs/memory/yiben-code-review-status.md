# 代码审查报告状态

> 2026-09-14 与 2026-09-19 两轮全面审查的问题均已修复（后者含发版链去预览版决策）；更旧报告勿照修

**两轮全面审查均已完成修复：**
- **2026-09-14 对 v0.2.1**（安全/主进程/渲染层）：全部修复并提交（commit「审查修复：安全纵深+取消语义收口+双云限流修正+条漫切话/恢复页修复」）。
- **2026-09-19 对 v0.2.2 + 未提交的更新渠道切换**：4 P1 + 约 12 P2 全部修复（未提交状态）：R2 渠道不再发预览版（CI prerelease 逻辑已删，项目决策=只有正式版）+ R2 上传后 HEAD 核验；老板键抽成 `main/bossKey.ts`（可录制任意组合键，结构校验在 `util/accelerator.ts`——必须含 Ctrl/Alt 或裸按 F 键；`app:bossKey`/`app:bossKey:set` IPC、帮助面板显示实际生效键）；条漫条带远端页按宽高比占位回收（RECYCLE_BEHIND=24，dims 由 PageImage onNatural 记录）；条漫嵌入话顶栏页码跳转就地落拼接话；云缓存 evict 幽灵扫描只在超限时做；`yiben://file` 改流式；协议缩略图/封面 inflight 去重；单双页 Ctrl+滚轮读 getState 防丢步；重试按钮不再冒泡翻页。

**Why:** 后续开发需要知道这些防线与决策已存在，避免重复修复或误判现状：
- 渲染进程已 sandbox、will-navigate 拦截（dev 用 origin 全等比对）、协议响应带 CSP；驱动双防线 + apiGate 限流照旧；
- 发版决策：**本项目不出预览版**，release.yml 已无 prerelease 逻辑，别再往 tag 流程里加 preview 分支；
- WebtoonViewer 的正确性前提仍是 `key={activeId}` 重挂 + initialPage 初始滚动 + readyForReport 门控；新增了 data-page 挂包装层（不再挂 img）、远端页回收——改条带渲染时保持这两点；
- 条漫嵌入话跳页：jumpTo 的分支顺序 = 嵌入话就地滚 > 回路由话 > 深链跨话 > 同话定位；
- fit/rotate/rtl 改动必须走 `patchReaderPrefs`。

**How to apply:** docs/CODE_REVIEW.md（09-11）与 09-14 报告均已修完，勿照修。cloud189 模块仍缺单测（工程缺口，两轮均未覆盖）。

相关：[Yiben 发版链](yiben-release-chain.md) [无头验证配方](yiben-headless-verify-recipe.md) [条漫跨话连续滚动](yiben-webtoon-cross-chapter.md)
