import { cloudCacheDir, cloudListAll } from './client'
import { scanCloudLibrary as scanCloudTree } from '../cloud/scanner'

export type { CloudScanProgress } from '../cloud/scanner'

/**
 * 扫描天翼云盘库。目录布局识别与入库在 cloud/scanner 共用实现里，
 * 这里只提供天翼的目录列举与缓存目录。
 */
export async function scanCloudLibrary(
  libraryId: number,
  cloudFolderId: string,
  familyId: string | undefined,
  onProgress?: (p: import('../cloud/scanner').CloudScanProgress) => void
): Promise<{ series: number; chapters: number; missing?: number }> {
  return scanCloudTree(
    {
      libraryId,
      cloudFolderId,
      familyId,
      listAll: (id) => cloudListAll(id, familyId),
      cacheDir: cloudCacheDir,
      scheme: 'cloud189'
    },
    onProgress
  )
}
