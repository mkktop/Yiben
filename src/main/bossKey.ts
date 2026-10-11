import { BrowserWindow, globalShortcut } from 'electron'
import { getSetting } from './settings'
import { isValidAccelerator } from './util/accelerator'

// ---- 老板键 ----
// 全局热键（焦点不在应用上也生效）：按一下立即隐藏窗口，再按恢复。
// 隐藏比最小化更彻底——任务栏不缩略、Alt+Tab 不露出（恢复走热键或重启应用）

// 「自动」时的主候选按序取第一个空闲的；每个加速键都会再注册其 Control+Alt
// 版本作为别名——右 Alt（AltGr）会被 Windows 翻译成 Ctrl+Alt，左/右 Alt 都能触发。
// 用户也可在设置里录制任意组合键（config: bossKey，'' = 自动），录制值经
// util/accelerator 校验：必须含 Ctrl/Alt（或 F 键裸按），防止系统级劫持打字键
export const BOSS_KEY_CANDIDATES = ['Alt+X', 'Alt+B', 'Control+Alt+X', 'Control+Alt+B']

let bossWindow: BrowserWindow | null = null
let lastBossToggleAt = 0
/** 实际注册成功的主键；'' = 全部候选被占用（设置页/帮助据此展示） */
let activeKey = ''

export function getBossKey(): string {
  return activeKey
}

function toggleBossHide(): void {
  // 长按时系统键盘自动重复会连发 WM_HOTKEY，窗口在隐藏/恢复间抖动、
  // 终态随奇偶随机（表现为「按了没隐藏」）——leading 防抖折叠成一次切换
  const now = Date.now()
  if (now - lastBossToggleAt < 400) return
  lastBossToggleAt = now
  const win = bossWindow
  if (!win || win.isDestroyed()) return
  if (win.isVisible() && !win.isMinimized()) {
    console.log('[bosskey] 触发: 隐藏窗口')
    win.hide()
  } else {
    console.log('[bosskey] 触发: 恢复窗口')
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

/** 注册一个加速键 + 其 Ctrl+Alt AltGr 别名，主键注册成功返回 true */
function registerWithAlias(acc: string): boolean {
  try {
    if (!globalShortcut.register(acc, toggleBossHide)) return false
    const alias = acc.startsWith('Alt+') ? `Control+${acc}` : acc
    if (alias !== acc) {
      try {
        if (!globalShortcut.register(alias, toggleBossHide)) {
          console.warn('[bosskey] 别名热键被占用:', alias)
        }
      } catch {
        /* 别名注册失败不影响主热键 */
      }
    }
    return true
  } catch {
    /* 加速键非法或系统拒绝 */
    return false
  }
}

export function registerBossKey(win: BrowserWindow): void {
  bossWindow = win
  activeKey = ''
  // 用户录制/固定的主键排最前，被占用时仍按候选顺序兜底；实际生效键经 app:bossKey 可查
  const preferred = getSetting<string>('bossKey', '')
  const order = isValidAccelerator(preferred) && preferred
    ? [preferred, ...BOSS_KEY_CANDIDATES.filter((c) => c !== preferred)]
    : BOSS_KEY_CANDIDATES
  for (const acc of order) {
    if (registerWithAlias(acc)) {
      activeKey = acc
      console.log('[bosskey] 已注册热键:', acc)
      return
    }
  }
  console.warn('[bosskey] 候选热键全部注册失败:', order.join(' / '))
}

/** 设置页改动主键后重注册；返回实际生效的键（全局热键只有老板键在用，unregisterAll 安全） */
export function reapplyBossKey(): string {
  globalShortcut.unregisterAll()
  if (bossWindow && !bossWindow.isDestroyed()) registerBossKey(bossWindow)
  return activeKey
}
