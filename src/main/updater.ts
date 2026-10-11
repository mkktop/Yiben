import { app } from 'electron'
import type { AppUpdater } from 'electron-updater'
import { broadcast } from './events'
import { cleanNotes, newerVersion } from './updateNotes'
import { getSetting } from './settings'

// ---- 应用内更新（R2 渠道 yudu-media.yeyushi.com，仅打包版；GitHub Release 仅作发布页镜像）----
// 交互模型：检查 -> 用户点「下载更新」（有进度条）-> 用户点「立即重启」。
// 不自动下载：安装包上百 MB，静默下载既耗流量又会在用户不知情时弹窗打断。
// 下载源配置不写死在代码里：electron-builder 打包时把 package.json 的 publish
// 段生成 resources/app-update.yml，electron-updater 运行时自读。
// 渠道切换（v0.2.2 起）：publish 段已切 generic 指向 R2 自定义域，老版本（GitHub 渠道）
// 不受影响，装上新版后即走 R2；CI 在传完 GitHub Release 后把 exe + latest.yml 推到桶里。

let updaterBusy = false
let downloadBusy = false
// 已下载待安装的版本：update-ready 事件只广播一次，renderer 重载后靠 app:update-state 查询恢复
let readyVersion = ''

// ---- 更新渠道 ----
// 用户可在设置页选主渠道（config: updateChannel = 'r2' | 'github'，默认 R2），
// 检查失败自动改用备用渠道再试一次。app-update.yml 烤的是 R2（generic），
// 这里每次检查前 setFeedURL 显式指渠道，保证切换可重复。
export type UpdateChannel = 'r2' | 'github'

const R2_FEED = {
  provider: 'generic',
  url: 'https://yudu-media.yeyushi.com'
} as const
const GH_FEED = {
  provider: 'github',
  owner: 'mkktop',
  repo: 'Yudu'
} as const

// 最近一次成功检查所用的渠道：renderer 重载后经 updateState 恢复展示
let servedChannel: UpdateChannel | '' = ''

function applyFeed(ch: UpdateChannel): void {
  getAutoUpdater().setFeedURL(ch === 'r2' ? R2_FEED : GH_FEED)
}

export interface UpdateCheckResult {
  status: 'dev' | 'busy' | 'available' | 'latest' | 'error'
  current: string
  version?: string
  notes?: string
  error?: string
  /** 本次检查实际服务的渠道（两个渠道都失败时缺省） */
  channel?: UpdateChannel
}

/** electron-updater 懒加载。打包后动态 import 的 CJS 互操作可能拿到
 * undefined（super_video v0.1.1 实测手动检查报 TypeError），require 直取最稳。 */
function getAutoUpdater(): AppUpdater {
  const m = require('electron-updater') as {
    autoUpdater?: AppUpdater
    default?: { autoUpdater?: AppUpdater }
  }
  const updater = m.autoUpdater ?? m.default?.autoUpdater
  if (!updater) throw new Error('electron-updater 加载失败')
  return updater
}

/** 打包版启动时挂监听（dev 调用是空操作）。必须在任何 checkForUpdates 之前调用，
 *  否则下载进度/完成事件没人接。 */
export function setupAutoUpdate(): void {
  if (!app.isPackaged) return
  try {
    const autoUpdater = getAutoUpdater()
    autoUpdater.autoDownload = false
    // 下载完成后退出应用即安装（electron-updater 标准行为）：用户不点「立即重启」
    // 而是直接关掉应用时，更新在下一次启动生效——显式声明以固定该语义
    autoUpdater.autoInstallOnAppQuit = true
    // 差分下载在 blockmap 缺失/错配时会把旧包拼成"新更新"（super_video 实测复现），
    // 禁用后走全量下载 + sha512 校验，一次性代价换正确性
    autoUpdater.disableDifferentialDownload = true
    autoUpdater.on('download-progress', (p) =>
      broadcast('app:update-progress', Math.round(p.percent))
    )
    autoUpdater.on('update-downloaded', (info) => {
      readyVersion = info.version
      broadcast('app:update-ready', info.version)
    })
    // EventEmitter 无 error 监听器即抛未捕获异常（离线点「检查更新」就崩主进程）
    autoUpdater.on('error', (e) => {
      console.error('[updater] error:', e)
    })
  } catch (e) {
    console.error('[updater] 初始化失败:', e)
  }
}

export async function checkUpdate(): Promise<UpdateCheckResult> {
  const current = app.getVersion()
  if (!app.isPackaged) return { status: 'dev', current }
  if (updaterBusy) return { status: 'busy', current }
  updaterBusy = true
  try {
    const preferred: UpdateChannel = getSetting<string>('updateChannel', 'r2') === 'github' ? 'github' : 'r2'
    const order: UpdateChannel[] = preferred === 'r2' ? ['r2', 'github'] : ['github', 'r2']
    // 两个渠道的失败原因都保留：只留最后一个会让排查时看不到主渠道的具体错误
    const errors: string[] = []
    for (const ch of order) {
      try {
        applyFeed(ch)
        const r = await getAutoUpdater().checkForUpdates()
        const version = r?.updateInfo?.version
        servedChannel = ch
        if (version && newerVersion(version, current)) {
          return {
            status: 'available',
            current,
            version,
            notes: cleanNotes(r?.updateInfo?.releaseNotes, version),
            channel: ch
          }
        }
        return { status: 'latest', current, version, channel: ch }
      } catch (e) {
        errors.push(`${ch === 'r2' ? 'R2' : 'GitHub'}: ${String(e)}`)
        console.warn(`[updater] ${ch} 渠道检查失败，改用备用渠道:`, e)
      }
    }
    return { status: 'error', current, error: errors.join('；') }
  } finally {
    updaterBusy = false
  }
}

export async function downloadUpdate(): Promise<{ ok: boolean; error?: string }> {
  if (downloadBusy) return { ok: false, error: '下载已在进行' }
  downloadBusy = true
  readyVersion = '' // 重新下载覆盖旧包，状态回到下载中
  try {
    await getAutoUpdater().downloadUpdate()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  } finally {
    downloadBusy = false
  }
}

export function installUpdate(): void {
  // 静默安装 + 装完自动拉起：辅助安装器（可选目录版）带 UI 运行会卡住更新流程
  getAutoUpdater().quitAndInstall(true, true)
}

/** renderer 重载后查询恢复：是否有已下载待安装的版本、是否正在下载、最近检查所用渠道 */
export function updateState(): { ready: string; downloading: boolean; channel: UpdateChannel | '' } {
  return { ready: readyVersion, downloading: downloadBusy, channel: servedChannel }
}
