# 无头验证配方

> 无头验证 Yiben 改动的配方：隔离 userData 跑 YUDU_SELFTEST/重扫；截图路径必须正斜杠；调试钩子已 is.dev 门控（打包版不响应）

改完 Yiben 后不开界面的验证套路（2026-09 实测有效）：

1. **一定要隔离 profile**：`YUDU_SELFTEST=<fixture>` 和 `libraries.rescan(1)` 都会写真实的 `%APPDATA%\雨读 Yudu\yudu.db`。加 `--user-data-dir=<临时目录>` 让 Electron 用独立 userData，避免污染用户的书架与进度。fixture 完整建库用 `FIX_ROOT=<目录> node scripts/make-fixture.js`（folder/跨页/zip，series=4 chapters=5 满足全部断言）；`genfix.js` 只刷新已有章节里的 PNG 不建结构。**fixture 只剩空目录残壳时 selftest 假失败**（协议读页 502/封面 404/系列数不足，2026-09-23 误判过一次），重跑 make-fixture 即恢复 14/14。品牌改名（一本 Yiben → 雨读 Yudu，2026-09-23）后：env 前缀 YUDU_、协议 yudu://、桥 window.yudu、DB yudu.db；用户拍板不留兼容层（无 legacyData 迁移，旧 `%APPDATA%\一本 Yiben` 数据不自动搬）。

2. **`YUDU_SCREENSHOT` 必须传正斜杠路径**（`cygpath -m /tmp/x.png` 得到 `C:/...`）。传 Git Bash 风格的反斜杠 Windows 路径时进程正常退出、不报错，但**截图文件根本不会生成**，容易误判成“钩子坏了”。同理 **`YUDU_ROUTE` 不能以 `#/` 或 `/` 开头传**——Git Bash 的 MSYS 路径转义会把它改写成 `#C:/Program Files/Git/settings`（页面空白、hash 错乱），传 `YUDU_ROUTE=settings`（不带斜杠，代码里会补 `#/`）。

3. **等界面稳定再截图**：`debugScreenshot` 里 `executeJavaScript` 会 await 返回的 promise，但 React 重渲染在那之后才发生。要拍“IPC 调用后的稳定状态”，把等待写进 eval 本身：`YUDU_EVAL="(async()=>{await window.yudu.libraries.rescan(1); await new Promise(r=>setTimeout(r,2000)); return 'ok'})()"`。

4. **不靠截图断言逻辑**：更有力的是直接读 DB。用 better-sqlite3 以 `readonly:true` 打开 profile 的 `yudu.db` 校验 page_count / progress / missing 等字段，比看图可靠。回归逻辑（如翻页方向）优先写成 vitest（`src/renderer/src/**/*.test.ts` 已纳入 include，alias 配在 vitest.config.ts），必要时再用 eval 在真实 UI 里复核。

5. **vitest 里测 DB/主进程模块的配方**（2026-09-12 实测，见 src/main/db/stats.test.ts）：`vi.mock('electron', () => ({ app: { getPath: () => mocks.userData } }))`，mocks 用 `vi.hoisted` 提升，beforeAll 里再 `mkdtempSync` 赋值；seed 数据必须先 `addLibrary`（series.library_id 外键）。better-sqlite3 句柄不关时 Windows 上 `rmSync` 临时目录报 EPERM——先调已导出的 `closeDb()`。测试文件各自独立进程，per-file electron mock 不互扰；但**同一文件内的用例共享同一个库**，后跑的用例会被先跑的污染（实例：streak 用例的「今天还没读」前提被先跑的增量用例写进今天的日志而失败）——用例开头清掉相关行、或用相对断言（总量差值/按章节过滤）而非绝对值。主进程模块若混合「纯函数 + 重依赖调用」，把重依赖（如 rescan/events/sharp 链）放进运行时 `await import('./diagnose' 内的 './rescan')` 懒加载：diagnose.test.ts 只 import normalizeTitle 等纯函数时就不会拖入 sharp/压缩包驱动链，electron mock 只需 `{ app }`。

6. **判断问题是否存量**：`git stash -u` → rebuild → 跑同一 selftest/测试 → `git stash pop` 比对基线再下结论。2026-09-12 用这招确认「PDF 崩整库扫描」是存量 bug 而非新改动引入（readComicInfoFromArchives 会对 PDF 章节开驱动抛 UnsupportedFormatError）；该 bug 同日已修，现在 genfix 的 PDF fixture 能跑通 selftest（14/14 PASS）。

7. **调试钩子已 is.dev 门控**（2026-09-12 安全修复）：YUDU_SCREENSHOT/EVAL/ROUTE/KEY/THEME 在 `debugScreenshot` 里被 `is.dev` 拦截——**打包版不再响应这些钩子**，别在产物上调试时误判为钩子坏了；`npx electron .`（未打包）仍可用。YUDU_SELFTEST 与 YUDU_A11Y 未被门控。

8. **文件关联 / 单实例锁的无头验证**（2026-09-12，随系统文件关联功能实测）：
   - 已加单实例锁：同一 `--user-data-dir` 的第二个 `npx electron .` 不会起新实例，而是把 argv 交给第一实例后自己退出——**并发跑两个实例必须用不同 profile**，这也会顺带触发 second-instance。
   - 冷启动双击：`npx electron . --user-data-dir=... "<文件路径>"` + `YUDU_EVAL` 内 sleep 5~6 秒再返回 `window.location.hash`（扫描→广播→导航在 ready-to-show 之后异步完成，eval 立即返回会是旧路由）。
   - 已运行双击：实例 A 用子 shell 后台启动 `( YUDU_ROUTE=library YUDU_EVAL="...sleep 12000..." YUDU_SCREENSHOT=... npx electron . --user-data-dir=A > /tmp/a.log 2>&1 & )`，sleep 5 秒后带同 profile + 文件参数启动实例 B；A 的 eval 应回报 `#/reader/N`。用普通 `&` 接管道链的后台写法偶发时序错乱（实测 A 没收到导航），优先用子 shell + 重定向日志，A/B 输出别用 grep 过滤掉 `[openFile]` 告警。
   - selftest 收尾的「整系列重置进度」会把 progress 清空——要验证「启动恢复上次阅读」与文件打开的优先级，需先跑 selftest 再用 better-sqlite3 手动 INSERT progress 种子，再带文件参数冷启动（断言打开的是文件章节而非种子章节）。
   - 造「体检/诊断」类数据（垃圾字节的坏 zip、只放 txt 的空文件夹、`海贼王 第2卷` 这类重名目录）时，selftest 会 FAIL「页数齐全」——这是预期（0 页坏包正是 scan_error 数据源），只为造库可无视该失败；2026-09-12 库体检冒烟即用此法种出 损坏 2/空 1/重复 1 的报告。
   - 给 CLI 传正斜杠文件路径（cygpath -m 形态）没问题：openFile.ts 入口已用 `resolve()` 规范化，历史上正/反斜杠会撞出重复章节/书库行的缺陷已修。

9. **eval 驱动 UI 交互 + DOM 断言**（2026-09-12，统计页/书架弹层实测）：YUDU_EVAL 里可跑完整「造数据→导航→点按钮→断言 DOM」链路，再配 YUDU_SCREENSHOT 拍稳态。例：先在 eval 里调 `window.yudu.shelves.create(...)` / `tags.setForSeries(...)` 造数据，再 `location.hash='#/library'` 等 1.5s 截图；打开弹层则导航到 `#/series/1` 后 `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('书架与标签'))?.click()`，以 `document.querySelector('.fixed.inset-0')` 是否存在断言弹层已开（返回值出现在 `[eval]` 日志里）。

11. **eval 里探测 Tailwind 类的坑**（2026-09-12，设计令牌验证实测）：eval 动态 createElement 挂类名读 computed style，只能命中**源码里实际用过**的工具类——Tailwind v4 按需生成，源码只有 `hover:shadow-md` 时裸 `.shadow-md` 规则根本不存在（computed boxShadow=none，不是 bug）。验证「令牌已注册且可解析」改用两招：直接 `getComputedStyle(document.documentElement).getPropertyValue('--elevation-md')` 读运行时变量值，或 grep `out/renderer/assets/index-*.css` 确认工具类输出了 `var(--elevation-*)` 引用。

12. **grep 产物 CSS 选择器的转义陷阱**（2026-09-12 实测）：bash 双引号包 `node -e` 查 `hover\:bg-destructive` 这类含转义冒号的选择器时，`\\\\` 经 bash→JS 两层反转义极易错成不匹配——曾连续误报三个 FAIL（bg-gradient-to-br、to-primary/85、hover:bg-destructive 实际全部存在）。断言产物规则优先用无反斜杠纯子串（`from-primary`、`radial-gradient(ellipse`）或 `css.matchAll(/[^{}]*keyword[^{]*\{[^}]*\}/g)` 打印规则全文再判断。**同一根因的 eval 变体**：YUDU_EVAL 里 `querySelector("div.aspect-\\[3\\/4\\]")` 的反斜杠经 Git Bash 环境变量传递也会被吃掉（Invalid selector 或静默失配）——改用 `el.firstElementChild` 按结构取节点、`el.className.includes("group-hover:text-primary")`（冒号在字符串比较里无害）。

13. **无头验证 :focus-visible 聚焦态**（2026-09-12，搜索框实测）：程序化 `input.focus()` 通常不匹配 `:focus-visible`；Chromium 专有参数 `inp.focus({focusVisible:true})` 可以。等 250ms 过渡结束后读 computed backgroundColor/boxShadow，可完整断言「聚焦浮起」（bg 切换 + ring + shadow），kbd 的 peer-focus:opacity-0 也借此验证。

14. **computed style 单次采样可能是过渡中间态**（2026-09-12，导航激活色实测）：route 切换后 800ms 读激活项 color 得到 muted(0.72) 而非 foreground(0.92)，复跑两次均稳定正确——首采撞进了 transition 中间值或迟到的路由翻转。诊断「颜色不对」先复跑/隔 300ms 双采样再下结论，别急着改代码。

15. **eval 里改样式后 capturePage 可能截到旧帧**（2026-09-12，首页水印排查实测）：debugScreenshot 的流程是 eval → capturePage，若 eval 同步 setStyle/display:none 后立刻返回，截图可能还是改动前的已提交帧——曾据此误判「水印完全没绘制」（对照 diff 0 像素）。改样式后必须在 eval 内 `await new Promise(r=>setTimeout(r,300~500))` 再返回（此前 img 打爆测占位的 5s 等待因此生效）。像素级验证用 sharp 读 PNG 原始像素比对（项目 node_modules 里有），比视觉模型可靠：水印 16% alpha 的单笔「一」字，视觉模型两次都漏检，像素扫描笔画区 (49,48,45) vs 背景 (14,13,11) 才是铁证。

16. **阅读器无头验证三坑**（2026-09-12，ReaderChrome 美化实测）：a) 阅读器 chrome 在鼠标静止 2200ms 后自动沉浸隐藏（ReaderPage IDLE_MS）——eval 结尾必须 `window.dispatchEvent(new MouseEvent('mousemove'))` + 等 ~500ms 再让 hook 截图，否则截图里没有任何栏位（全图像素恒等于底图即此因，别误判成样式没生效）；b) `rounded-full` 的 computed borderRadius 序列化为 `2.23696e+07px`（calc(infinity*1px) 的解析值），断言别写 `=== '9999px'`；c) 方向 hint 每个 ReaderPage 实例只触发一次且 2400ms 自消，同路由参数切换（#/reader/2→#/reader/3）不重挂组件、ref 复用不再触发，eval 启动时 boot hint 的窗口也早过——验 hint 容器样式改用双页下按 C 触发文字 hint（确定性路径）。末页卡/面板不受 immersive 门控，截图可稳定呈现。

17. **for 循环批量跑无头验证时输出会整段丢失**（2026-09-12，四页双主题验证实测）：`for …; do … npx electron . 2>&1 | grep -E "…" | head -4; done` 这种循环内三段管道偶发全部输出丢失（单跑同命令正常）——改成 `> 日志文件 2>&1` 再对文件 grep 最稳。另：1.5 DPR 下 computed borderWidth/borderBottomWidth 是 '0.666667px'，断言边框要用 `parseFloat(x) >= 0.5` 而非 `=== '1px'`；产物 CSS 里查 `hover:bg-accent/60` 这类转义选择器用 `grep -oF '.hover\:bg-accent\/60:hover'`（-F 字面量，bash 单引号原样传递）。

18. **确定性触发 Toast 的无头配方**（2026-09-12，Toast 统一实测）：造 profile 副本后改 yudu.db 的 libraries.path——指向 fixture 副本且 `fs.renameSync` 藏起一个系列目录 → `libraries.rescan(id)` 收到 scan:notice level=warn；插入一条 path 不存在的库 → rescan 抛错收到 level=error。UI 断言 `.animate-toast-in` 的 animationName/duration（toast-in 0.25s）；注意首探常落在滑入动画中途，getBoundingClientRect 的 right 会带着 translateX 位移（实测 rightGap=0 正是动画在跑的证据），位置断言要么等 400ms 过渡完要么读 top。半透明水印类弱元素视觉模型稳定漏检（12% alpha 的「一」又漏一次），像素扫描是终审。

19. **视觉模型对「位置」也会幻觉**（2026-09-12，Toast 宿主验证实测）：第三次记录视觉模型不可靠——它声称 Toast「向左偏移 300+px、与工具栏按钮重叠」，而 computed style 实测 `right:24px/top:72px`，sharp 像素仲裁（扫 destructive 红系图标包围盒，注意限定右侧 25% 区域，否则主色 logo/渐变会被一起框进来）与计算值吻合。结论固化：**布局类断言以 computed style 为准，像素仲裁兜底，视觉模型只用于「有没有渲染出来」级别的粗检**；它的位置/间距/对比度投诉一律先证伪再动手。

10. **YUDU_EVAL 单独跑不会退出应用**（2026-09-12 实测）：debugScreenshot 只在带 YUDU_SCREENSHOT 时才 capturePage + app.quit()——只传 EVAL 验证交互时应用一直挂着，外层管道永不结束。eval-only 也要配一个 YUDU_SCREENSHOT 目标当「退出开关」。
    - **被 kill 的后台任务会残留 electron.exe 占着单实例锁**：TaskStop/杀 shell 不一定杀掉 electron 子进程，之后同 profile 的新实例被单实例锁静默挡掉（无 `[eval]` 输出、无截图，极像钩子坏了）。重跑前先 `taskkill //F //IM electron.exe` 清场。

相关：[Electron 调试配方](electron-safeStorage-decrypt-recipe.md)

补充（2026-09，返回按钮排查）：SPA（hash 路由）里判断「当前页面」不要信 computer-use 的 a11y 树——路由切换后它会长期返回陈旧快照，必须用 `screenshot` 看真实像素；另外实测 Electron dev 下 `navigate(-1)`/`history.back()` 可能完全静默无效（len=2、idx 正确仍 no-op），Yiben 已改为确定性返回（idx>0 时 back + 250ms 未离开则显式 navigate('/') 兜底）。诊断 SPA 内部状态可用「写 document.title → 读窗口标题」的探针，HMR 立即生效。

补充（2026-09-13，theme store 单主题化实测）：**vitest(node 环境)测 zustand persist 的迁移必须同时 stub `window.localStorage`**——zustand v5 默认 storage 是 `createJSONStorage(() => window.localStorage)`，window 缺失时探测抛错被静默吞掉，persist 整体禁用（getItem 零调用、state 恒为默认值），极像 migrate 写错。桩要给 `vi.stubGlobal('window', { localStorage: stub })` 与 `vi.stubGlobal('localStorage', stub)` 双份。另两个坑：rehydrate 在微任务里完成，动态 import 后要先 `await setTimeout(0)` 再断言；同文件循环跑多个迁移 case 时每个 case 都要 `vi.resetModules()`，否则拿到上一 case 的模块缓存实例（症状是只有第一个 case 对、后面全串）。
