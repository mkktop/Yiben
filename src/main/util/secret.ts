import { safeStorage } from 'electron'

/** safeStorage 加密为 base64（isEncryptionAvailable 为 false 的环境退回明文） */
export function encryptSecret(plain: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plain).toString('base64')
  }
  return plain
}

/** 解密 encryptSecret 的产物；旧版明文数据解析不出时原样返回 */
export function decryptSecret(stored: string): string {
  if (!stored) return ''
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return stored
  }
}
