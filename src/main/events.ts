import { BrowserWindow } from 'electron'

/** 向所有窗口广播事件（扫描进度、云盘下载进度等） */
export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}
