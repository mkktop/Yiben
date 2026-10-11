import { scanCloudLibrary, type CloudScanProgress } from '../cloud/scanner'
import { webdavList, webdavCacheDir } from './client'
export function scanWebDavLibrary(
  libraryId: number,
  onProgress?: (progress: CloudScanProgress) => void
) {
  return scanCloudLibrary(
    {
      libraryId,
      cloudFolderId: 'root',
      listAll: (id) => webdavList(libraryId, id),
      cacheDir: () => webdavCacheDir(libraryId),
      scheme: `webdav-${libraryId}`
    },
    onProgress
  )
}
