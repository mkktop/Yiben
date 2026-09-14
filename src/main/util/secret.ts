import { safeStorage } from 'electron'

/**
 * 凭据信封格式（v1）：`enc:v1:<base64>`（safeStorage 加密）/ `plain:v1:<明文>`（降级）。
 * 此前加密/明文不可区分——safeStorage 不可用的环境静默落明文，且解密端
 * 「解析不出就当原文」让两种形态无法审计。带前缀后降级落盘是显式可检出的。
 * 旧数据无前缀：仍按「先当加密解，失败当明文」的兼容路径读，读后原样返回。
 */
const ENC_PREFIX = 'enc:v1:'
const PLAIN_PREFIX = 'plain:v1:'

export function isSecretEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

/** 加密为信封；safeStorage 不可用时返回显式标记的明文信封 */
export function encryptSecret(plain: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64')
  }
  console.warn('[secret] safeStorage 不可用，凭据将以标记明文形式落盘')
  return PLAIN_PREFIX + plain
}

/** 解密 encryptSecret 的产物；v1 信封按标记分派，旧数据走兼容路径 */
export function decryptSecret(stored: string): string {
  if (!stored) return ''
  if (stored.startsWith(ENC_PREFIX)) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'))
    } catch {
      // 加密数据解不开就是废数据（换机器/换 OS 用户），不回退当明文猜
      return ''
    }
  }
  if (stored.startsWith(PLAIN_PREFIX)) return stored.slice(PLAIN_PREFIX.length)
  // 旧版无前缀：可能是加密 base64 也可能是降级明文，按可解性区分
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return stored
  }
}
