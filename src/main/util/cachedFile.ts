import { stat } from 'fs/promises'
import { longPath } from './paths'

/** 存在不足以代表完整；云端给出大小时必须匹配，未知大小至少排除空文件。 */
export async function isCompleteFile(path: string, expectedSize: number): Promise<boolean> {
  const file = await stat(longPath(path)).catch(() => null)
  return Boolean(file?.isFile() && (expectedSize > 0 ? file.size === expectedSize : file.size > 0))
}
