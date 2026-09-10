import { openDb } from './db'

/** 轻量 JSON KV 设置（存 SQLite，替代 electron-store 的 ESM 互操作麻烦） */
export function getSetting<T>(key: string, fallback: T): T {
  const db = openDb()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  if (!row) return fallback
  try {
    return JSON.parse(row.value) as T
  } catch {
    return fallback
  }
}

export function setSetting<T>(key: string, value: T): void {
  const db = openDb()
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, JSON.stringify(value))
}
