# 条漫跨话连续滚动

> 条漫跨话连续滚动的架构约束：条带全局页号 + 软切换归属话；store 页码属于当前视口话，改阅读器前必读

Yiben 条漫模式已实现跨话连续滚动（2026-09-12，WebtoonViewer + ReaderPage）：临近本话末尾差 2 页时经 `reader.neighbors(tailId)` 把下一话页节点直接拼进同一条带（可链式多话）；PDF/页数未知（云端未下载）的话拼不进条带，标 noMore 后走旧的 onNext（滚到底进下一话）兜底。

改阅读器时必须遵守的不变量：

- **data-page 是条带全局页号**（useCurrentPageObserver 跨话取「最小跨越页」需要单调序），不是话内局部页码；store 的 page/pageCount 则是**当前视口话的局部值**——两者相差 `embedded.start` 偏移。ReaderPage 的 `scrollStripTo(local, absolute)` 负责补偏移（Home 用 absolute 回条带顶）。
- ReaderPage 用 `embedded` 状态做「软切换」：进度节流写入、书签切换/高亮、±3 页预载、页码指示全部跟随 `positionId = embedded?.id ?? activeId`，跨分界/滚回由观察者驱动，全程不导航不重载。
- 嵌入期间 store 的 pageCount 属于拼接话：`chapter:pageCount` 回填广播写 store 前必须检查 embeddedRef，否则会用路由话页数覆盖掉。
- WebtoonViewer 用 baseRef 冻结路由话页数（extras 非空时不跟随 store），条带布局不被软切换污染；路由话变化时 extras/noMore 整体重置。
- 拼接触发条件是 `global >= nextStart - 2`（nextStart = 条带末尾的全局起点）。写错过一版 `nextStart + tailCount - 2` 导致永不触发——nextStart 本身就是末尾，别再加尾话页数。
- 末页「本话完」卡片经 hideEndCard prop 关闭（下一话可拼接时）；键盘上边界在嵌入话第 0 页时滚回上一话末页（软切换切回）而非 goPrev，下边界到底则停住（防误跳话）。

无头验证配方：`setPrefs(seriesId, {mode:'webtoon'})` → 导航进首话 → 滚 `sc.scrollTop = sc.scrollHeight` 等 1.5s → 数 `[data-page]` 节点（应为本话+下一话页数之和）→ 读 DB progress：两话各有进度行即证明软切换双向生效；分界线 DOM 文案「下一话 · 标题」。注意 eval-only 跑不退出应用，须配 YUDU_SCREENSHOT（见 [无头验证配方](yiben-headless-verify-recipe.md)）。

相关：[B站漫画阅读器模式](bilibili-manga-reader-patterns.md) [无头验证配方](yiben-headless-verify-recipe.md)
