# 一本 Yiben — UI 美化方案与执行提示词

> 用途：本文档分两部分——**前半是美化方案**（给人看的设计决策），**后半是可复制给另一个 AI 直接执行的提示词**（含项目上下文、硬约束、验收标准）。  
> 提示词按任务切分，可整篇交给 AI 一次做完，也可逐任务分别执行。
>
> 生成日期：2026-09-12 ｜ 基于 v0.1.1 代码

---

# 第一部分：现状评估

## 已有的好底子（不要推倒重来）

- 完整的 shadcn 风格 oklch 设计令牌（`src/renderer/src/index.css`），浅色「暖纸」/ 深色「墨色」双主题，切换机制（`stores/theme.ts`）已可用。
- 品牌调性已具雏形：朱砂主色（`oklch(0.55 0.19 32)`）+ 衬线中文标题（`font-serif`）+ 暖纸底色，符合「一本」书房气质。
- 组件化基础良好：Button/Input/Skeleton 基件、AppShell 骨架、虚拟滚动封面墙，代码干净。

## 主要差距（本次美化要解决的）

| # | 问题                                                              | 位置                   |
| - | --------------------------------------------------------------- | -------------------- |
| 1 | 界面偏「灰平」：无阴影分层、无氛围色，页面之间缺少视觉纵深                                   | 全局                   |
| 2 | 动效不成体系：全项目只有 `hint-pop` 一个 keyframes，过渡几乎都是 `transition-colors` | 全局                   |
| 3 | 侧边栏纯平：激活项只有底色变化，无指示条/图标着色；Logo 区简陋                              | `AppShell.tsx`       |
| 4 | 封面墙 hover 只有缩放+描边，缺悬浮抬升、阴影；无封面时占位单调；已读/进度无视觉标识                  | `CoverGrid.tsx`      |
| 5 | 首页问候区太素，「继续阅读」卡片缺乏书架感                                           | `HomePage.tsx`       |
| 6 | 阅读器顶栏/底栏是实色块，遮挡画面且无毛玻璃质感                                        | `ReaderChrome.tsx`   |
| 7 | 设置/统计/网盘页分组卡片样式不统一，行间距随意                                        | `SettingsPage.tsx` 等 |
| 8 | 空状态、骨架屏、弹窗、Toast 各自为政，无统一规范                                     | 多处                   |

---

# 第二部分：美化方向「纸墨书斋」

## 设计关键词

**暖纸 · 墨分五色 · 朱砂点印 · 悬浮书影**

白天是洒进书房的光（暖纸底 + 柔和分层阴影），夜晚是案头一盏灯（暖黑底 + 琥珀光晕）。所有改进必须双主题同时成立。

## 2.1 色彩（在现有令牌上增量调整，不推翻）

- 主**色保持朱砂（浅色 `oklch(0.55 0.19 32)` / 深色 `oklch(0.66 0.19 33)`），不动。**
- **新增两个氛围令牌（两主题各一值）：**
  - **`--ambient`：页面顶部氛围光色。浅色建议 `oklch(0.85 0.06 70)`，深色建议&#x20;**`oklch(0.45 0.09 50)`。
  - `--cover-placeholder`：无封面占位底色，比 `muted` 略暖。
- 深色主题的 `--muted-foreground` 亮度从 `0.68` 提到约 `0.72`，改善正文可读性。

## 2.2 阴影分层（新增，核心改进）

在 `@theme inline` 中新增 4 级高度令牌，两主题分别定义（深色阴影更重、更柔）：

```css
/* 浅色 */
--shadow-xs: 0 1px 2px oklch(0.4 0.03 60 / 0.06);
--shadow-sm: 0 2px 6px -1px oklch(0.4 0.03 60 / 0.08);
--shadow-md: 0 6px 16px -4px oklch(0.4 0.03 60 / 0.12);
--shadow-lg: 0 16px 40px -12px oklch(0.4 0.03 60 / 0.18);
/* 深色：透明度提到 0.3~0.5，扩散更大 */
```

用途约定：`xs`=输入框/芯片，`sm`=按钮/小卡片，`md`=封面/卡片常态，`lg`=悬浮封面/弹窗。

## 2.3 圆角与间距

- 保持 `--radius: 0.625rem` 不变。
- 封面、卡片统一 `rounded-xl`（当前 `rounded-lg` 与 `rounded-xl` 混用，统一为 xl）。
- 页面主容器统一 `mx-auto max-w-[1400px] p-8`，各页补齐（目前有的页没有）。

## 2.4 字体层级

- 页面主标题：`font-serif text-2xl font-semibold`（保持）。
- 区块标题：从「灰色小字」升级为 `text-sm font-semibold text-foreground` + 图标用主色，提高层级感。
- 数字（统计页、页码）可加 `tabular-nums`。

## 2.5 动效语言（新增统一 keyframes）

在 `index.css` 增加并全局复用：

| 名称           | 效果                | 用途                      |
| ------------ | ----------------- | ----------------------- |
| `fade-in`    | 透明度 0→1，200ms     | 页面切换、列表出现               |
| `rise-in`    | 上浮 8px + 淡入，250ms | 卡片、区块入场                 |
| `scale-in`   | 0.96→1 + 淡入，150ms | 弹窗、浮层                   |
| `shimmer`    | 背景位移动画            | 骨架屏呼吸                   |
| `cover-lift` | 位移 -4px + 阴影过渡    | 封面悬浮（用 transition 实现即可） |

原则：卡片悬浮「抬升 + 加深阴影」；进场「上浮 + 淡入」；所有可点元素悬浮反馈 ≤200ms。尊重 `prefers-reduced-motion`（媒体查询下关闭动画）。

---


# 第三部分：分模块美化清单

1. **设计令牌（index.css）**：新增阴影 4 级、`--ambient`、5 组 keyframes、骨架屏 shimmer、深色可读性微调、`prefers-reduced-motion` 兜底。这是所有后续任务的地基。
2. **侧边栏 + 顶栏（AppShell / WindowControls）**：激活导航项加左侧 3px 主色指示条 + 图标主色着色；Logo「一」字块加 `shadow-sm` 与微渐变；搜索框聚焦态加 `ring-2 ring-primary/30` 与背景浮起；窗口关闭按钮 hover 变红（`hover:bg-destructive hover:text-destructive-foreground`）。
3. **氛围层（AppShell main 区）**：主内容区顶部加一条 `--ambient` 径向渐变光晕（`pointer-events-none`，高约 240px，不遮挡交互），双主题各自调校透明度。
4. **封面墙（CoverGrid / CoverImage）**：卡片常态 `shadow-md`，hover 时 `scale-[1.03]` + `shadow-lg` + 上浮；底部标题渐变遮罩从「hover 才出现」改为「常显弱化版 + hover 加强」；无封面占位改为渐变底 + 衬线首字 + 书脊纹理感；已读完的系列右上角加主色对勾徽章，在读的封面底部加 3px 进度条。
5. **首页（HomePage）**：问候区升级为 Hero——`font-serif text-3xl` + 日期副文案 + 氛围渐变底；「继续阅读」卡片加大封面（h-28）、进度条加粗到 1.5、hover 抬升；空状态改用品牌插画式构图（大衬线「一」水印 + 引导文案 + 主色按钮）。
6. **阅读器 Chrome（ReaderChrome）**：顶栏/底栏改为 `bg-background/80 backdrop-blur-md` 毛玻璃悬浮条，圆角 `rounded-xl`、悬浮于内容之上（m-3）；页码指示加 `tabular-nums`；按钮 hover 加 `bg-accent` 圆形底。
7. **设置 / 统计 / 网盘 / 详情页**：统一分组卡片规范——`rounded-xl border bg-card shadow-sm`，卡片头 `border-b border-border/60 px-5 py-3.5`，卡片体 `p-5 space-y-4`；统计页数字 `text-2xl font-semibold tabular-nums`；系列详情页头部可做「封面缩略 + 模糊背景」横幅。
8. **弹窗 / Toast / 空状态 / 骨架屏**：弹窗统一 `rounded-2xl shadow-lg` + `scale-in` 入场 + 遮罩 `bg-black/50 backdrop-blur-sm`；Toast 统一右上滑入；空状态统一 `EmptyHint` 升级版（图标 + 主文案 + 副文案 + 可选按钮）；骨架屏加 `shimmer` 扫光。

---

# 第四部分：可直接复制的 AI 执行提示词

## 通用上下文块（目标 AI 不在本项目工作区时，务必前置）

```
项目：一本 Yiben — 本地 + 天翼云盘漫画阅读器，代码在 D:\work\Yiben（Windows 环境）。
技术栈：Electron 44 + React 18 + TypeScript + electron-vite + Tailwind CSS v4（@tailwindcss/vite）
        + zustand + react-router-dom + lucide-react + better-sqlite3。包管理器 pnpm。
渲染层目录：src/renderer/src/
  - index.css                  设计令牌（oklch CSS 变量 + @theme inline），浅色 :root / 深色 .dark
  - App.tsx / main.tsx         路由入口
  - components/layout/         AppShell.tsx（侧边栏+顶栏）、WindowControls.tsx
  - components/library/        CoverGrid.tsx（虚拟滚动封面墙）、CoverImage.tsx
  - components/ui/             button.tsx、input.tsx、skeleton.tsx
  - routes/                    HomePage、LibraryPage、SeriesPage、CloudPage、StatsPage、SettingsPage、reader/
命令：pnpm dev（开发预览）、pnpm typecheck（主+渲染进程类型检查，必须过）、
      pnpm test（vitest，必须过）、pnpm build。
现有设计令牌（index.css）已含 --background/--foreground/--card/--primary(朱砂)/
--muted/--accent/--border/--ring/--sidebar 等完整 shadcn 风格变量，浅色为暖纸、深色为墨色。
```

## 通用硬约束（所有任务共用，建议原样附上）

```
【硬约束】
1. 只做视觉/样式改动：严禁修改任何业务逻辑、IPC、数据库、store 状态结构、组件 props 语义。
2. 不新增任何 npm 依赖（不动 package.json）。动效用纯 CSS keyframes 实现。
3. 使用 Tailwind v4 写法；颜色一律引用 index.css 中的 CSS 变量令牌（bg-card、text-muted-foreground
   这类），禁止写死十六进制颜色；新增色值必须先加进 index.css 的两套主题里。
4. 浅色、深色两套主题必须同时适配，每个改动都要脑内过一遍深色模式效果。
5. 动画需包裹在 @media (prefers-reduced-motion: no-preference) 中，或提供 reduced-motion 兜底。
6. 每完成一个任务，必须跑 pnpm typecheck 和 pnpm test，两者全绿才算完成；不得跳过。
7. 保持现有代码风格：无分号差异随意但跟随文件现状、中文注释、组件函数式写法。
```

---

### 任务 T1：设计令牌升级（地基，最先做）

```
任务：升级 D:\work\Yiben\src\renderer\src\index.css 的设计令牌，为全 App 建立阴影、氛围色与动效体系。

要求：
1. 在 :root 与 .dark 各新增 --ambient（页面顶部氛围光色，浅色偏暖米金、深色偏琥珀）
   和 --cover-placeholder（无封面占位底色，比 --muted 略暖），并注册进 @theme inline。
2. 在 @theme inline 新增 4 级阴影令牌 --shadow-xs/sm/md/lg，浅色深色分别用 CSS 变量定义
   （深色阴影更重更柔），供 shadow-md、shadow-lg 等工具类使用。
3. 新增 keyframes：fade-in、rise-in（上浮8px+淡入）、scale-in（0.96→1）、shimmer（骨架扫光），
   并各配一个同名工具类（如 .animate-rise-in）。全部包在
   @media (prefers-reduced-motion: no-preference) 里。
4. 骨架屏：给 .skeleton 类（components/ui/skeleton.tsx 的根类）加 shimmer 扫光效果
   （线性渐变背景位移动画），替换或叠加现有 pulse。
5. 深色主题 --muted-foreground 亮度略提（约 oklch 0.72），提升正文可读性。
6. 滚动条美化：webkit 内核补 ::-webkit-scrollbar 样式（8px 宽、圆角滑块、透明轨道、
   hover 加深），保留现有 Firefox scrollbar-width/color。

验收：pnpm typecheck 与 pnpm test 全绿；pnpm dev 打开后浅色/深色切换无异常、无控制台报错。
```

### 任务 T2：侧边栏与顶栏精修

```
任务：精修 D:\work\Yiben\src\renderer\src\components\layout\AppShell.tsx 与 WindowControls.tsx。

要求：
1. 侧边栏激活导航项：在现有 bg-sidebar-accent 基础上，左侧加 3px 主色圆角指示条
   （可用相对定位 + 伪元素或一个 span 实现），图标与文字着色为 foreground（非 muted），
   过渡 150ms。
2. Logo 区「一」字方块：加 shadow-sm 与主色微渐变（from-primary to-primary/85），
   整体 hover 时轻微 scale。
3. 侧边栏底部版本号区：排版收紧，有更新时的小红点保持，整行 hover 有反馈。
4. 顶栏搜索框：聚焦态加 ring-2 ring-primary/30，背景从 bg-muted/60 浮起为 bg-background
   并带 shadow-xs；Ctrl K 的 kbd 样式微调（更圆、更淡）。
5. WindowControls：关闭按钮 hover 变红（bg-destructive + 白字），最小化/最大化 hover
   用 bg-accent；按钮区与拖拽区（-webkit-app-region）逻辑不得改动。
6. 主内容区（<main>）顶部叠加一层 --ambient 径向渐变光晕（绝对定位、h-60、
   pointer-events-none、透明度浅色约 35% 深色约 20%），营造「书房顶光」。

验收：pnpm typecheck 与 pnpm test 全绿；浅色/深色下激活态、hover、聚焦态均正常。
```

### 任务 T3：封面墙升级

```
任务：升级 D:\work\Yiben\src\renderer\src\components\library\CoverGrid.tsx 与 CoverImage.tsx
的封面卡片视觉。

要求：
1. 卡片常态 rounded-xl + shadow-md；hover 时图片 scale-[1.03]、卡片整体 translateY(-4px)
   + shadow-lg，过渡 200ms；保留选择模式的 ring 逻辑不动。
2. 底部标题渐变遮罩：常态显示弱化版（opacity-60），hover 加强到 opacity-100；
   标题文字 text-white 加 text-shadow 或遮罩加深保证可读。
3. 无封面占位（CoverImage 无图分支）：改为 --cover-placeholder 渐变底 + 书名首字的
   大号衬线字 + 左侧 6px 深色竖条模拟书脊，双主题适配。
4. 阅读状态标识：series 若已全部读完，右上角叠一个主色圆形对勾徽章（带 shadow）；
   在读未完的，封面底部叠 3px 主色进度条（宽度按已读比例）。数据字段先读
   src/shared/types.ts 里 Series 定义确认可用字段，没有进度字段就只做空占位钩子、
   不要编造数据。
5. 卡片下方文字区：标题行加 hover:text-primary 过渡；作者行保持 muted。

验收：pnpm typecheck 与 pnpm test 全绿；虚拟滚动性能不受影响（不得改虚拟化逻辑）。
```

### 任务 T4：首页 Hero 化

```
任务：美化 D:\work\Yiben\src\renderer\src\routes\HomePage.tsx。

要求：
1. 问候区升级为 Hero：标题 font-serif text-3xl，副文案包含当前日期（如「9月12日 星期六」），
   区块背后衬一层 --ambient 氛围渐变（圆角 rounded-2xl、padding 加大）。
2. 「继续阅读」卡片：封面加高到 h-28，进度条加粗到 h-1.5 并加 rounded-full 轨道阴影，
   hover 整卡 translateY(-2px) + shadow-md；卡片容器横向滚动条隐藏或美化。
3. 区块标题（继续阅读/最近添加）从灰色小字升级为 text-sm font-semibold 前景色 +
   主色图标。
4. 空状态：改用品牌构图——超大半透明衬线「一」字水印 + 主文案 + 副文案 + 主色按钮
   （跳书架），复用或升级 EmptyHint。
5. 各区块入场加 rise-in 交错（可用 style={{ animationDelay }} 做 60ms 级联，
   纯 CSS 实现，不引库）。

验收：pnpm typecheck 与 pnpm test 全绿；有数据/无数据两种状态都检查。
```

### 任务 T5：阅读器工具栏毛玻璃化

```
任务：美化 D:\work\Yiben\src\renderer\src\routes\reader\ReaderChrome.tsx（阅读器顶栏/底栏/
面板/末页卡片），不触碰翻页、渲染、快捷键等任何逻辑。

要求：
1. 顶栏与底栏改为悬浮毛玻璃条：bg-background/80 backdrop-blur-md + rounded-xl +
   border border-border/50 + shadow-lg，距边缘 m-3 悬浮于画面之上（注意保持原有
   自动显示/隐藏逻辑不变）。
2. 栏上按钮统一 size-8 圆形、hover:bg-accent，激活的功能按钮（如书签已加）用主色着色。
3. 页码/进度指示加 tabular-nums；进度滑杆（若有）轨道与拇指按主色体系美化。
4. 底部提示浮层沿用 hint-pop，但容器统一为毛玻璃圆角条样式，与顶底栏一致。
5. 书签面板、快捷键帮助面板：统一 rounded-2xl shadow-lg + scale-in 入场。
6. 末页「下一话」卡片：居中卡片化，主色按钮 + 次要幽灵按钮排布。

验收：pnpm typecheck 与 pnpm test 全绿；单页/双页/条漫三模式下栏位不遮挡交互。
```

### 任务 T6：设置/统计/网盘/详情页卡片规范化

```
任务：统一 D:\work\Yiben\src\renderer\src\routes\ 下 SettingsPage.tsx、StatsPage.tsx、
CloudPage.tsx、SeriesPage.tsx 的分组卡片规范。

要求：
1. 统一卡片：rounded-xl border bg-card shadow-sm；卡片头 border-b border-border/60
   px-5 py-3.5（标题 text-sm font-semibold）；卡片体 p-5 space-y-4。四页全部套用，
   替换各自为政的现有写法。
2. 页面主容器统一 mx-auto max-w-[1400px] p-8（统计页可放宽到 max-w-[1200px]）。
3. SettingsPage：ToggleRow 开关加 hover 反馈与过渡；分区之间间距统一 space-y-6。
4. StatsPage：统计数字 text-2xl font-semibold tabular-nums + 主色或语义色图标；
   图表/条形区域用主色系渐变，圆角统一。
5. CloudPage：网盘条目行 hover:bg-accent/60 rounded-lg，类型徽章（天翼云/115/本地）
   统一小圆角 chip 样式。
6. SeriesPage：头部做「封面 + 书名 + 元信息」横幅，背景用封面模糊放大 + 深色渐变遮罩
   （双主题适配）；章节列表行 hover 统一。

验收：pnpm typecheck 与 pnpm test 全绿；四页浅色/深色各检查一遍。
```

### 任务 T7：弹窗/Toast/空状态统一

```
任务：统一 D:\work\Yiben 渲染层的弹窗、Toast 与空状态规范。

范围（先全局搜索定位）：书库管理弹窗（LibraryPage.tsx 内 LibraryManager）、
CloudNoticeToast.tsx、各确认弹窗、所有 EmptyHint 使用处。

要求：
1. 弹窗：统一 rounded-2xl + shadow-lg + scale-in 入场动画；遮罩统一
   bg-black/50 backdrop-blur-sm；标题栏与按钮区样式向 T6 卡片规范看齐。
2. Toast：统一为右上角滑入（translate + fade，250ms），成功/警告/错误三态配色
   分别用 primary / 琥珀语义色 / destructive，圆角条状 + 图标。
3. 琥珀语义色如令牌中没有，先在 index.css 两主题各加 --warning 与 --warning-foreground
   并注册 @theme inline。
4. EmptyHint 升级：图标放大至 size-10、加主文案 text-sm font-medium 与副文案
   text-xs text-muted-foreground 两层结构，支持可选 action 按钮插槽；
   所有调用处适配新结构。
5. 全局检查：删除各处重复定义的空状态/弹窗样式，收敛到统一组件。

验收：pnpm typecheck 与 pnpm test 全绿；触发一次 Toast 与各弹窗人工确认动效。
```

---

## 执行顺序建议

**T1 → T2 → T3 → T4 → T5 → T6 → T7**，逐个提交（每个任务一个 commit），任何一步 typecheck/test 不过就停下来修复再继续。若时间有限，优先级最高的三件套是 **T1 + T3 + T5**（令牌地基、封面墙、阅读器），收益最大。

## 最终验收清单

- [ ] `pnpm typecheck` 全绿
- [ ] `pnpm test` 全绿
- [ ] `pnpm dev` 启动后：浅色/深色切换、五个页面、阅读器三模式、弹窗/Toast 全部人工过一遍
- [ ] 无新增依赖、无业务逻辑改动（`git diff --stat` 应只涉及 tsx/css 的样式部分）
- [ ] `prefers-reduced-motion` 下动画全部关闭
