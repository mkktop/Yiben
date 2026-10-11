import Database from 'better-sqlite3'
import { app } from 'electron'
import { copyFile, mkdir, readdir, rename, rm, stat } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { openDb } from './db'
import { getSetting } from './settings'
import type { DatabaseBackup } from '../shared/types'

const NAME = /^(backup|before-restore)-\d{13}-[a-f0-9-]+\.sqlite$/
const directory = (): string => join(app.getPath('userData'), 'backups')
const pendingPath = (): string => join(app.getPath('userData'), 'pending-restore.sqlite')
let chain: Promise<unknown> = Promise.resolve()
let lastSnapshot = 0
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn)
  chain = next.catch(() => {})
  return next
}

export function validateDatabase(file: string): void {
  const check = new Database(file, { readonly: true, fileMustExist: true })
  try {
    if (check.pragma('quick_check', { simple: true }) !== 'ok')
      throw new Error('备份数据库完整性校验失败')
    const tables = check
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>
    if (
      !['libraries', 'series', 'chapters', 'progress', 'settings'].every((name) =>
        tables.some((row) => row.name === name)
      )
    ) {
      throw new Error('不是雨读的数据库备份')
    }
    check.prepare('SELECT chapter_id, page, completed, updated_at FROM progress LIMIT 1').all()
    if ((check.pragma('foreign_key_check') as unknown[]).length)
      throw new Error('备份数据库存在无效关联')
  } finally {
    check.close()
  }
}

export async function listBackups(): Promise<DatabaseBackup[]> {
  await mkdir(directory(), { recursive: true })
  const list: DatabaseBackup[] = []
  for (const name of await readdir(directory())) {
    if (!NAME.test(name)) continue
    const info = await stat(join(directory(), name))
    if (info.isFile())
      list.push({
        id: name,
        createdAt: Number(/-(\d{13})-/.exec(name)![1]),
        bytes: info.size,
        safety: name.startsWith('before-restore')
      })
  }
  return list.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
}

async function snapshot(safety = false): Promise<DatabaseBackup> {
  await mkdir(directory(), { recursive: true })
  const createdAt = Math.max(Date.now(), lastSnapshot + 1)
  lastSnapshot = createdAt
  const id = `${safety ? 'before-restore' : 'backup'}-${createdAt}-${randomUUID()}.sqlite`
  const temp = join(directory(), `${id}.tmp`)
  try {
    await openDb().backup(temp)
    validateDatabase(temp)
    await rename(temp, join(directory(), id))
  } finally {
    await rm(temp, { force: true })
  }
  const retention = Math.min(
    30,
    Math.max(1, Math.floor(Number(getSetting('backupRetention', 7))) || 7)
  )
  const all = await listBackups()
  for (const safetyGroup of [false, true]) {
    for (const old of all.filter((entry) => entry.safety === safetyGroup).slice(retention)) {
      await rm(join(directory(), old.id), { force: true })
    }
  }
  return { id, createdAt, bytes: (await stat(join(directory(), id))).size, safety }
}

export function createBackup(): Promise<DatabaseBackup> {
  return exclusive(() => snapshot())
}

export function autoBackup(): Promise<void> {
  return exclusive(async () => {
    if (getSetting<boolean>('backupEnabled', true) === false) return
    const last = (await listBackups()).find((item) => !item.safety)
    if (!last || Date.now() - last.createdAt >= 24 * 60 * 60 * 1000) await snapshot()
  })
}

/** 当前连接继续使用，下一次启动打开 DB 前原子替换，避免恢复中写入旧 WAL。 */
export function scheduleRestore(id: string): Promise<void> {
  return exclusive(async () => {
    if (!NAME.test(id)) throw new Error('备份名称无效')
    const source = join(directory(), id)
    validateDatabase(source)
    const temp = `${pendingPath()}.tmp`
    // 先复制选中的备份：安全快照的保留策略可能清掉最旧的普通备份。
    try {
      await copyFile(source, temp)
      await snapshot(true)
      await rename(temp, pendingPath())
    } finally {
      await rm(temp, { force: true })
    }
  })
}

/** 仅在 openDb 之前调用。 */
export async function applyPendingRestore(): Promise<void> {
  const pending = pendingPath()
  const info = await stat(pending).catch(() => null)
  if (!info) return
  validateDatabase(pending)
  const file = join(app.getPath('userData'), 'yudu.db')
  const temp = `${file}.restore-tmp`
  await copyFile(pending, temp)
  await rm(`${file}-wal`, { force: true })
  await rm(`${file}-shm`, { force: true })
  await rename(temp, file)
  await rm(pending, { force: true })
}
