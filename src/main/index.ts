import { app, shell, BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { writeFile } from 'fs/promises'
import { is } from '@electron-toolkit/utils'
import { openDb } from './db'
import { registerProtocol, attachProtocolHandlers } from './protocol'
import { registerIpc } from './ipc'
import { runSelfTest } from './selftest'
import { getSetting, setSetting } from './settings'
import { startWatchers } from './watcher'

// 必须在 app ready 之前注册自定义协议
registerProtocol()

// 开发验证用：YIBEN_SCREENSHOT=<png路径>，可选 YIBEN_ROUTE=<hash路由> / YIBEN_THEME=light
async function debugScreenshot(win: BrowserWindow): Promise<void> {
  const target = process.env['YIBEN_SCREENSHOT']
  if (!target) return
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log('[renderer]', level, message)
  })
  const theme = process.env['YIBEN_THEME']
  if (theme === 'light') {
    await win.webContents.executeJavaScript(
      `document.documentElement.classList.remove('dark')`
    )
    await new Promise((r) => setTimeout(r, 400))
  }
  const route = process.env['YIBEN_ROUTE']
  if (route) {
    // Git Bash 会把 "/xxx" 形态的环境变量按路径转换，这里兼容不带 #/ 的写法
    const hash = route.startsWith('#') ? route : `#/${route.replace(/^\/+/, '')}`
    await win.webContents.executeJavaScript(`location.hash = '${hash}'`)
    await new Promise((r) => setTimeout(r, 800))
  }
  const key = process.env['YIBEN_KEY']
  if (key) {
    // 模拟按键（验证翻页/进度等交互）
    for (let i = 0; i < Number(process.env['YIBEN_KEY_TIMES'] ?? 1); i++) {
      await win.webContents.executeJavaScript(
        `window.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}' }))`
      )
      await new Promise((r) => setTimeout(r, 150))
    }
    await new Promise((r) => setTimeout(r, 600))
  }
  const evalExpr = process.env['YIBEN_EVAL']
  if (evalExpr) {
    const result = await win.webContents
      .executeJavaScript(evalExpr)
      .then((r) => JSON.stringify(r))
      .catch((err) => `EVAL_ERROR: ${err}`)
    console.log('[eval]', result)
  }
  const image = await win.webContents.capturePage()
  await writeFile(target, image.toPNG())
  app.quit()
}

interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized?: boolean
}

/** 旧坐标可能落在已拔掉的显示器上：任一当前显示器能完整容纳才恢复位置 */
function restorableBounds(saved: WindowBounds | null): WindowBounds | null {
  if (!saved || !saved.width || !saved.height || saved.x === undefined || saved.y === undefined) {
    return null
  }
  const fits = screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return (
      saved.x! >= a.x - 10 &&
      saved.y! >= a.y - 10 &&
      saved.x! + saved.width <= a.x + a.width + 10 &&
      saved.y! + saved.height <= a.y + a.height + 10
    )
  })
  return fits ? saved : null
}

function createWindow(): void {
  const saved = restorableBounds(getSetting<WindowBounds | null>('windowBounds', null))
  const mainWindow = new BrowserWindow({
    width: saved?.width ?? 1280,
    height: saved?.height ?? 820,
    x: saved?.x,
    y: saved?.y,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#171412',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  if (saved?.maximized) mainWindow.maximize()

  // getNormalBounds 在最大化时返回还原后的尺寸，恢复时不糊
  mainWindow.on('close', () => {
    try {
      setSetting('windowBounds', {
        ...mainWindow.getNormalBounds(),
        maximized: mainWindow.isMaximized()
      })
    } catch {
      /* 窗口已销毁等场景忽略 */
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    void debugScreenshot(mainWindow)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // YIBEN_A11Y=1 时向系统暴露网页无障碍树（供桌面自动化测试 / 读屏器使用）
  if (process.env['YIBEN_A11Y']) app.accessibilitySupportEnabled = true

  openDb()
  attachProtocolHandlers()
  registerIpc()

  // 本地库文件监听（可在设置里关闭）；自测模式不启动
  if (!process.env['YIBEN_SELFTEST'] && getSetting('autoRescan', true)) startWatchers()

  const fixture = process.env['YIBEN_SELFTEST']
  if (fixture) {
    void runSelfTest(fixture)
    return
  }

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
