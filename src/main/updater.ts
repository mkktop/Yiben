import { app } from 'electron'
import type { AppUpdater } from 'electron-updater'
import { broadcast } from './events'
import { cleanNotes, newerVersion } from './updateNotes'

// ---- 应用内更新（GitHub Releases，仅打包版；公共仓库无需 token）----
// 交互模型：检查 -> 用户点「下载更新」（有进度条）-> 用户点「立即重启」。
// 不自动下载：安装包上百 MB，静默下载既耗流量又会在用户不知情时弹窗打断。
// 下载源配置不写死在代码里：electron-builder 打包时把 package.json 的 publish
// 段生成 resources/app-update.yml，electron-updater 运行时自读。

let updaterBusy = false
let downloadBusy = false
// 已下载待安装的版本：update-ready 事件只广播一次，renderer 重载后靠 app:update-state 查询恢复
let readyVersion = ''

export interface UpdateCheckResult {
  status: 'dev' | 'busy' | 'available' | 'latest' | 'error'
  current: string
  version?: string
  notes?: string
  error?: string
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
    const r = await getAutoUpdater().checkForUpdates()
    const version = r?.updateInfo?.version
    if (version && newerVersion(version, current)) {
      return {
        status: 'available',
        current,
        version,
        notes: cleanNotes(r?.updateInfo?.releaseNotes, version)
      }
    }
    return { status: 'latest', current, version }
  } catch (e) {
    return { status: 'error', current, error: String(e) }
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

/** renderer 重载后查询恢复：是否有已下载待安装的版本、是否正在下载 */
export function updateState(): { ready: string; downloading: boolean } {
  return { ready: readyVersion, downloading: downloadBusy }
}
