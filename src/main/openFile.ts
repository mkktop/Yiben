import { existsSync } from 'fs'
import { basename, dirname, resolve } from 'path'
import { addLibrary, getChapterByPath, rebuildFts } from './db'
import { scanOneLocalSeries } from './scanner'
import { broadcast } from './events'
import { longPath } from './util/paths'
import { runExclusiveScan } from './rescan'

/**
 * 系统文件关联：双击 .cbz/.cbr/.cb7/.cbt/.pdf 直接进阅读器。
 * Windows 经命令行参数（冷启动 argv / second-instance argv）；
 * macOS 经 open-file 事件（也汇入 handleFilePath）。
 * 与打包配置里的 fileAssociations 保持同一份扩展名清单。
 */
const OPEN_EXTS = ['.cbz', '.cbr', '.cb7', '.cbt', '.pdf']

/** 窗口是否已 ready-to-show（渲染层可收广播） */
let windowReady = false
/** ready-to-show 之前解析出的章节：暂存等窗口就绪；渲染层挂载后也可主动领取 */
let pendingChapterId: number | null = null

/** ready-to-show 时调用：暂存的章节此刻补发广播 */
export function markWindowReady(): void {
  windowReady = true
  const id = pendingChapterId
  if (id == null) return
  // 不清 pending：渲染层若因挂载时序错过这条推送，还能经 takePendingOpenFile 领取
  broadcast('app:openFile', { chapterId: id })
}

/** 渲染层挂载后主动领取一次待打开的章节（防止推送早于监听注册而丢失） */
export function takePendingOpenFile(): number | null {
  const id = pendingChapterId
  pendingChapterId = null
  return id
}

/** 从命令行参数里挑出第一个可打开的现存文件路径 */
export function handleArgv(argv: string[]): void {
  const file = argv.find((arg) => {
    const dot = arg.lastIndexOf('.')
    if (dot < 0) return false
    // resolve 统一斜杠方向与相对形态：与扫描入库的路径口径一致，避免同一文件重复入库
    return OPEN_EXTS.includes(arg.slice(dot).toLowerCase()) && existsSync(longPath(resolve(arg)))
  })
  if (file) void openFilePath(resolve(file))
}

/** macOS open-file 事件入口；格式不支持时静默忽略 */
export function handleFilePath(path: string): void {
  const p = resolve(path)
  const dot = p.lastIndexOf('.')
  if (dot < 0 || !OPEN_EXTS.includes(p.slice(dot).toLowerCase())) return
  if (!existsSync(longPath(p))) return
  void openFilePath(p)
}

/**
 * 打开单个漫画文件：把所在目录登记为书库（addLibrary 对同一 path 幂等），
 * 以「单文件系列」扫描入库，取到章节后广播给渲染层。
 * 任何失败只落日志不弹框——双击打开不该被错误弹窗打断。
 */
async function openFilePath(path: string): Promise<void> {
  try {
    const folder = dirname(path)
    const lib = addLibrary(basename(folder), folder)
    await runExclusiveScan(
      () => scanOneLocalSeries(lib.id, { folder: path, isSingleFile: true }),
      true
    )
    rebuildFts()
    const chapter = getChapterByPath(path)
    if (!chapter) return
    if (windowReady) broadcast('app:openFile', { chapterId: chapter.id })
    else pendingChapterId = chapter.id
  } catch (err) {
    console.warn('[openFile] 打开文件失败:', err instanceof Error ? err.message : err)
  }
}
