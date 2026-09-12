import { X } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * 快捷键帮助（? 键 / 顶栏按钮）：把快捷键画在一块键盘上，
 * 高亮实际用到的键并在键帽上方标注动作，下方附完整速查表。
 */

interface Cap {
  k: string
  /** 键帽宽度（键位单位），默认 1 */
  u?: number
  hot?: boolean
  /** 键帽上方的小字动作标注 */
  act?: string
  /** 标注对齐：l = 靠键帽左缘（相邻高亮键的标注向外生长避免重叠） */
  al?: 'l' | 'r'
}

const UNIT = 26
const GAP = 3

const ROWS: Cap[][] = [
  [
    { k: 'Esc', u: 1.5, hot: true, act: '返回', al: 'l' },
    { k: '', u: 0.75 },
    { k: 'F1' },
    { k: 'F2' },
    { k: 'F3' },
    { k: 'F4' },
    { k: '', u: 0.25 },
    { k: 'F5' },
    { k: 'F6' },
    { k: 'F7' },
    { k: 'F8' },
    { k: '', u: 0.25 },
    { k: 'F9' },
    { k: 'F10' },
    { k: 'F11' },
    { k: 'F12' }
  ],
  [
    { k: '`' },
    { k: '1' },
    { k: '2' },
    { k: '3' },
    { k: '4' },
    { k: '5' },
    { k: '6' },
    { k: '7' },
    { k: '8' },
    { k: '9' },
    { k: '0' },
    { k: '-' },
    { k: '=' },
    { k: '⌫', u: 2, hot: true, act: '上一页', al: 'l' }
  ],
  [
    { k: 'Tab', u: 1.5 },
    { k: 'Q' },
    { k: 'W' },
    { k: 'E' },
    { k: 'R', hot: true },
    { k: 'T', hot: true },
    { k: 'Y' },
    { k: 'U' },
    { k: 'I' },
    { k: 'O' },
    { k: 'P' },
    { k: '[' },
    { k: ']' },
    { k: '\\', u: 1.5 }
  ],
  [
    { k: 'Caps', u: 1.75 },
    { k: 'A' },
    { k: 'S', hot: true },
    { k: 'D', hot: true },
    { k: 'F', hot: true },
    { k: 'G' },
    { k: 'H' },
    { k: 'J' },
    { k: 'K' },
    { k: 'L' },
    { k: ';' },
    { k: "'" },
    { k: '⏎', u: 2.25, hot: true, act: '沉浸模式', al: 'r' }
  ],
  [
    { k: 'Shift', u: 2.25 },
    { k: 'Z' },
    { k: 'X' },
    { k: 'C', hot: true },
    { k: 'V' },
    { k: 'B', hot: true },
    { k: 'N' },
    { k: 'M', hot: true },
    { k: ',' },
    { k: '.' },
    { k: '/' },
    { k: 'Shift', u: 2.75 }
  ],
  [
    { k: 'Ctrl', u: 1.5 },
    { k: 'Alt', u: 1.25 },
    { k: '空格', u: 7, hot: true, act: '下一页', al: 'l' },
    { k: 'Alt', u: 1.25 },
    { k: 'Ctrl', u: 1.5 },
    { k: '', u: 1 }
  ]
]

const NAV: Cap[] = [
  { k: 'Home', hot: true },
  { k: 'PgUp', hot: true, act: '上页' },
  { k: 'End', hot: true },
  { k: 'PgDn', hot: true, act: '下页' }
]

/** 方向键：↑ 居中在上，← ↓ → 在下 */
const ARROW_TOP: Cap[] = [{ k: '' }, { k: '↑', hot: true }, { k: '' }]
const ARROW_BOTTOM: Cap[] = [
  { k: '←', hot: true },
  { k: '↓', hot: true },
  { k: '→', hot: true }
]

const LEGEND: Array<[string, string]> = [
  ['下一页', '空格 / → / ↓ / PgDn / 点击前进侧'],
  ['上一页', '退格 / ← / ↑ / PgUp / 点击后退侧'],
  ['点击翻页', '左右 1/3 区域，随阅读方向（不跨话）'],
  ['末页继续翻', '自动进入下一话；首页回退到上一话末页'],
  ['跨页配对 C', '双页模式：切换两两配对的起始偏移'],
  ['阅读模式 M', '单页 / 双页 / 条漫循环'],
  ['方向 D', '日漫（从右往左）/ 西漫（从左往右）'],
  ['适配 S', '适宽 / 适高 / 原始循环'],
  ['缩放', 'Ctrl + 滚轮；右下角 ± 按钮'],
  ['Home / End', '第一页 / 最后一页'],
  ['书签 B', '收藏 / 取消当前页'],
  ['沉浸 ⏎', '隐藏界面，鼠标移动自动恢复'],
  ['旋转 R', '逆时针旋转 90°'],
  ['缩略图 T', '页面缩略图条'],
  ['全屏 F', '全屏切换'],
  ['帮助 ?', '打开本面板'],
  ['返回 Esc', '退出全屏 / 返回书架']
]

function KeyCap({ cap }: { cap: Cap }): ReactNode {
  const width = `calc(${(cap.u ?? 1) * UNIT}px - ${GAP}px)`
  if (!cap.k) return <div style={{ width }} className="shrink-0" />
  return (
    <div className="relative shrink-0" style={{ width }}>
      {cap.act && (
        <span
          className={`absolute -top-[17px] z-10 whitespace-nowrap rounded bg-background/95 px-1 py-px text-[9px] font-medium leading-none text-primary shadow-sm ${
            cap.al === 'l' ? 'left-0.5' : cap.al === 'r' ? 'right-0.5' : 'left-1/2 -translate-x-1/2'
          }`}
        >
          {cap.act}
        </span>
      )}
      <div
        className={`flex h-[23px] items-center justify-center rounded border text-[10px] leading-none ${
          cap.hot
            ? 'border-primary/60 bg-primary font-semibold text-primary-foreground'
            : 'bg-muted/70 text-muted-foreground'
        }`}
      >
        {cap.k}
      </div>
    </div>
  )
}

function Row({ caps }: { caps: Cap[] }): ReactNode {
  return (
    <div className="flex gap-[3px]">
      {caps.map((c, i) => (
        <KeyCap key={`${c.k}-${i}`} cap={c} />
      ))}
    </div>
  )
}

export function KeyboardHelp({ onClose }: { onClose: () => void }): ReactNode {
  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="animate-scale-in max-h-[92vh] w-[680px] max-w-full overflow-y-auto rounded-2xl border border-border/50 bg-background/80 p-5 shadow-lg backdrop-blur-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold">快捷键</h3>
          <button
            onClick={onClose}
            className="grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* 键盘图：左侧主键区，右侧导航/方向键簇 */}
        <div className="mb-5 flex items-end justify-center gap-5 pt-5">
          <div className="flex flex-col gap-[3px]">
            {ROWS.map((caps, i) => (
              <Row key={i} caps={caps} />
            ))}
          </div>
          <div className="flex flex-col gap-[3px] pb-[26px]">
            <div className="grid grid-cols-2 gap-[3px]">
              {NAV.map((cap, i) => (
                <KeyCap key={i} cap={cap} />
              ))}
            </div>
            <div className="mt-2 flex flex-col gap-[3px]">
              <div className="flex gap-[3px]">
                {ARROW_TOP.map((c, i) => (
                  <KeyCap key={i} cap={c} />
                ))}
              </div>
              <div className="flex gap-[3px]">
                {ARROW_BOTTOM.map((c, i) => (
                  <KeyCap key={i} cap={c} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 速查表 */}
        <div className="grid gap-x-6 gap-y-1.5 border-t border-border/60 pt-3 text-xs sm:grid-cols-2">
          {LEGEND.map(([keys, desc]) => (
            <div key={keys} className="flex items-baseline justify-between gap-3">
              <kbd className="shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                {keys}
              </kbd>
              <span className="min-w-0 text-right text-muted-foreground">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
