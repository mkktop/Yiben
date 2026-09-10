import { ElectronAPI } from '@electron-toolkit/preload'
import type { YibenApi } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    yiben: YibenApi
  }
}
