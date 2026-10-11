import type { YuduApi } from './index'

declare global {
  interface Window {
    yudu: YuduApi
  }
}
