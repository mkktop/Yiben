import { app, shell, BrowserWindow, screen, dialog, globalShortcut } from 'electron'
import { join } from 'path'
import { writeFile } from 'fs/promises'
import { is } from '@electron-toolkit/utils'
import { openDb } from './db'
import { registerProtocol, attachProtocolHandlers } from './protocol'
import { registerIpc } from './ipc'
import { broadcast } from './events'
import { runSelfTest } from './selftest'
import { getSetting, setSetting } from './settings'
import { startWatchers } from './watcher'
import { setupAutoUpdate } from './updater'
import { registerBossKey } from './bossKey'
import { handleArgv, handleFilePath, markWindowReady } from './openFile'
import { applyPendingRestore, autoBackup } from './backup'
import { restoredContentSize } from './util/windowBounds'

// 必须在 app ready 之前注册自定义协议
registerProtocol()

// macOS：访达双击 /「打开方式」经 open-file 进来（冷启动时在 ready 之前触发，先收下排队）
app.on('open-file', (_e, path) => handleFilePath(path))

// 单实例锁：并发实例会各自起扫描、各写一份 SQLite（WAL 也会互相卡）；
// 同时它是文件关联的前提——第二个实例把文件路径交给已有实例后退出
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // 第二个实例启动时：把已有窗口拉到前台（含老板键隐藏中的），并接手它带来的文件参数
  app.on('second-instance', (_e, argv) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      if (!win.isVisible()) win.show()
      win.focus()
    }
    handleArgv(argv)
  })
  bootstrap()
}

function bootstrap(): void {
  app
    .whenReady()
    .then(async () => {
      // YUDU_A11Y=1 时向系统暴露网页无障碍树（供桌面自动化测试 / 读屏器使用）
      if (process.env['YUDU_A11Y']) app.accessibilitySupportEnabled = true

      await applyPendingRestore()
      openDb()
      if (!process.env['YUDU_SELFTEST'])
        void autoBackup().catch((error) => console.warn('[backup]', error))
      attachProtocolHandlers()
      registerIpc()
      // 打包版挂 electron-updater 监听（进度/就绪广播）；dev 下是空操作
      setupAutoUpdate()
      // 清扫上次崩溃/强杀残留的 .part 半成品（不影响启动，异步进行）
      void import('./cloud189/cache').then((m) => m.cleanupPartFiles()).catch(() => {})

      // 本地库文件监听（可在设置里关闭）；自测模式不启动
      if (!process.env['YUDU_SELFTEST'] && getSetting('autoRescan', true)) startWatchers()

      const fixture = process.env['YUDU_SELFTEST']
      if (fixture) {
        void runSelfTest(fixture)
        return
      }

      createWindow()

      // 冷启动带文件参数（双击文件/「打开方式」）：窗口建好后解析并打开
      handleArgv(process.argv)

      app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
      })
    })
    .catch((err) => {
      // openDb 抛错（磁盘满/DB 损坏）等启动失败不能静默白屏
      console.error('[boot] 初始化失败:', err)
      dialog.showErrorBox('雨读启动失败', err instanceof Error ? err.message : String(err))
      app.quit()
    })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // 老板键是全局热键：应用退出必须注销，否则热键被残留注册占死（见 bossKey.ts）
  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
  })
}

// ---------- 老板键 ----------
// 实现在 bossKey.ts（ipc.ts 也要查询实际生效键，独立模块避免循环依赖）

// 开发验证用：YUDU_SCREENSHOT=<png路径>，可选 YUDU_ROUTE=<hash路由> / YUDU_THEME=paper|comic|neon（兼容旧值 light）
// is.dev 门控：这些钩子允许向渲染进程注入任意 JS，不能跟着编译进生产包
async function debugScreenshot(win: BrowserWindow): Promise<void> {
  if (!is.dev) return
  const target = process.env['YUDU_SCREENSHOT']
  if (!target) return
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log('[renderer]', level, message)
  })
  const theme = process.env['YUDU_THEME']
  const themeName =
    theme === 'comic' || theme === 'dark'
      ? 'comic'
      : theme === 'neon'
        ? 'neon'
        : theme
          ? 'paper'
          : undefined
  if (themeName) {
    await win.webContents.executeJavaScript(
      `document.documentElement.dataset.theme = '${themeName}';
       document.documentElement.classList.toggle('dark', ${themeName !== 'paper'})`
    )
    await new Promise((r) => setTimeout(r, 400))
  }
  const route = process.env['YUDU_ROUTE']
  if (route) {
    // Git Bash 会把 "/xxx" 形态的环境变量按路径转换，这里兼容不带 #/ 的写法
    const hash = route.startsWith('#') ? route : `#/${route.replace(/^\/+/, '')}`
    await win.webContents.executeJavaScript(`location.hash = '${hash}'`)
    await new Promise((r) => setTimeout(r, 800))
  }
  const key = process.env['YUDU_KEY']
  if (key) {
    // 模拟按键（验证翻页/进度等交互）
    for (let i = 0; i < Number(process.env['YUDU_KEY_TIMES'] ?? 1); i++) {
      await win.webContents.executeJavaScript(
        `window.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}' }))`
      )
      await new Promise((r) => setTimeout(r, 150))
    }
    await new Promise((r) => setTimeout(r, 600))
  }
  const evalExpr = process.env['YUDU_EVAL']
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
    // dev 下窗口/任务栏用品牌图标；打包版的 exe 已内嵌 build/icon.ico，交给系统取 exe 图标
    icon: is.dev ? join(app.getAppPath(), 'resources/icon.png') : undefined,
    // 无边框：标题栏由渲染层顶栏承担（app-region 拖拽 + 自绘控制按钮）
    frame: false,
    backgroundColor: '#171412',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // 渲染层核心工作是解码不可信内容（网盘/压缩包里的图片与 PDF），
      // 必须保留 OS 级沙箱：contextIsolation 只防脚本渗透，不防解码器内存破坏
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  if (saved && process.platform === 'win32') {
    // Windows 缩放下 constructor 会额外计入外框；按当前差值恢复，避免每次重开变大。
    const size = restoredContentSize(saved, mainWindow.getNormalBounds(), mainWindow.getContentBounds())
    mainWindow.setContentSize(size.width, size.height)
  }
  if (saved?.maximized) mainWindow.maximize()

  // 最大化状态推给渲染层，WindowControls 切换 最大化/还原 图标
  const pushMaximized = (): void => broadcast('window:maximized', mainWindow.isMaximized())
  mainWindow.on('maximize', pushMaximized)
  mainWindow.on('unmaximize', pushMaximized)

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
    // 渲染层可见了：冷启动暂存的待打开章节此刻补发广播
    markWindowReady()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // 只放行常见网页协议交给系统打开；file:/yudu:/其他自定义协议一律不外开
    if (/^(https?|mailto):/i.test(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  registerBossKey(mainWindow)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 只允许应用自身页面导航（hash 路由切换、dev 热重载）：
  // 一旦放行外部地址，远程页面将继承 preload 注入的 IPC 能力。
  // dev 用 origin 全等比对（startsWith 会放过 localhost:5173.evil.com 这类前缀伪装）；
  // 生产是 file:// 精确页面路径前缀，锚定 index.html 本身
  const devOrigin =
    is.dev && process.env['ELECTRON_RENDERER_URL']
      ? new URL(process.env['ELECTRON_RENDERER_URL']).origin
      : null
  const appPagePrefix = `file:///${join(__dirname, '../renderer/index.html').replace(/\\/g, '/')}`
  mainWindow.webContents.on('will-navigate', (e, url) => {
    let allowed = false
    if (devOrigin) {
      try {
        allowed = new URL(url).origin === devOrigin
      } catch {
        allowed = false
      }
    } else {
      allowed = url.startsWith(appPagePrefix)
    }
    if (!allowed) {
      console.warn('[nav] 已拦截非应用导航:', url)
      e.preventDefault()
    }
  })
}
