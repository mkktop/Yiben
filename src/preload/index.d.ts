import type { YibenApi } from './index'

declare global {
  interface Window {
    yiben: YibenApi
  }
}
