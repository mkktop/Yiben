import { cloud115CacheDir, cloud115ListAll } from './client'
import { scanCloudLibrary } from '../cloud/scanner'

export type { CloudScanProgress } from '../cloud/scanner'

/** 扫描 115 网盘库：目录布局识别与入库走 cloud/scanner 共用实现 */
export async function scan115Library(
  libraryId: number,
  cloudFolderId: string,
  onProgress?: (p: import('../cloud/scanner').CloudScanProgress) => void
): Promise<{ series: number; chapters: number; missing?: number }> {
  return scanCloudLibrary(
    {
      libraryId,
      cloudFolderId,
      listAll: cloud115ListAll,
      cacheDir: cloud115CacheDir,
      scheme: 'cloud115'
    },
    onProgress
  )
}
