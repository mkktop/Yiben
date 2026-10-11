/** Electron 全局快捷键加速键的合法性校验（不依赖 Electron，可单测）。
 *  渲染层传来的老板键值一律先过这里，不合法直接拒绝——
 *  globalShortcut.register 对非法加速键会抛错，且裸字母组合会被系统级劫持成打字键。 */

const MODIFIERS = new Set([
  'Control',
  'Ctrl',
  'Alt',
  'AltGr',
  'Shift',
  'Super',
  'Meta',
  'Command',
  'Cmd',
  'CommandOrControl'
])

/** F1–F24（Electron 上限） */
const FKEY_RE = /^F(?:[1-9]|1[0-9]|2[0-4])$/

/** 单字符主键：字母/数字/常见标点（globalShortcut 按 VK 码解析 OEM 键） */
const SINGLE_KEY_RE = /^[A-Z0-9\-=[\];'`,.\\/]$/

/** 具名主键（Electron accelerator 的标准键名） */
const NAMED_KEY_RE =
  /^(?:F(?:[1-9]|1[0-9]|2[0-4])|Space|Tab|Backspace|Delete|Insert|Return|Home|End|PageUp|PageDown|Up|Down|Left|Right|Plus|Minus|Equal)$/

/** '' 是合法值：表示「自动按候选顺序挑选」。
 *  结构要求：1–4 段、修饰键在前且不重复、主键在白名单内（单段仅限裸按的 F 功能键）；
 *  安全线：必须有 Control 或 Alt（纯 Shift/裸键会全局劫持正常打字），F 功能键可单独用。 */
export function isValidAccelerator(v: unknown): boolean {
  if (v === '') return true
  if (typeof v !== 'string') return false
  const parts = v.split('+')
  if (parts.length > 4 || parts.length === 0) return false
  if (parts.length === 1) return FKEY_RE.test(parts[0])
  const mods = parts.slice(0, -1)
  const key = parts[parts.length - 1]
  if (new Set(mods).size !== mods.length) return false
  if (!mods.every((m) => MODIFIERS.has(m))) return false
  if (!SINGLE_KEY_RE.test(key) && !NAMED_KEY_RE.test(key)) return false
  if (FKEY_RE.test(key)) return true
  return mods.some((m) => ['Control', 'Ctrl', 'Alt', 'AltGr', 'CommandOrControl'].includes(m))
}
