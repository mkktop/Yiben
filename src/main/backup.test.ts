import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => mock.dir } }))
import { openDb, closeDb, addLibrary } from './db'
import {
  autoBackup,
  createBackup,
  listBackups,
  scheduleRestore,
  applyPendingRestore,
  validateDatabase
} from './backup'
import { setSetting } from './settings'

beforeAll(() => {
  mock.dir = mkdtempSync(join(tmpdir(), 'yudu-backup-'))
  openDb()
  addLibrary('原始库', 'D:/backup-original')
  setSetting('backupRetention', 3)
})
afterAll(() => {
  closeDb()
  rmSync(mock.dir, { recursive: true, force: true })
})
describe('数据库一致性备份', () => {
  it('WAL 中的书库与偏好被快照，并可校验', async () => {
    setSetting('readerPrefs', { 1: { rtl: false } })
    const backup = await createBackup()
    expect(backup.bytes).toBeGreaterThan(0)
    expect(() => validateDatabase(join(mock.dir, 'backups', backup.id))).not.toThrow()
  })
  it('自动备份当天不重复，关闭时不创建', async () => {
    const before = (await listBackups()).length
    await autoBackup()
    await autoBackup()
    expect((await listBackups()).length).toBe(before)
    setSetting('backupEnabled', false)
    await autoBackup()
    expect((await listBackups()).length).toBe(before)
  })
  it('恢复前创建安全备份，并在关闭连接后原子恢复', async () => {
    const original = await createBackup()
    addLibrary('恢复前新增库', 'D:/backup-new')
    await scheduleRestore(original.id)
    expect((await listBackups()).some((entry) => entry.safety)).toBe(true)
    expect(openDb().prepare('SELECT COUNT(*) AS n FROM libraries').get()).toEqual({ n: 2 })
    closeDb()
    await applyPendingRestore()
    expect(openDb().prepare('SELECT COUNT(*) AS n FROM libraries').get()).toEqual({ n: 1 })
    // 重开后预编译语句不能仍指向已经关闭的连接。
    expect(() => addLibrary('重开后库', 'D:/reopened')).not.toThrow()
  })
  it('路径逃逸或损坏文件不能排队恢复，当前数据库不受影响', async () => {
    await expect(scheduleRestore('../yudu.db')).rejects.toThrow('备份名称无效')
    const broken = 'backup-1700000000000-00000000-0000-0000-0000-000000000000.sqlite'
    writeFileSync(join(mock.dir, 'backups', broken), '损坏文件')
    const before = readFileSync(join(mock.dir, 'yudu.db'))
    await expect(scheduleRestore(broken)).rejects.toThrow()
    expect(readFileSync(join(mock.dir, 'yudu.db'))).toEqual(before)
    rmSync(join(mock.dir, 'backups', broken))
  })
  it('保留数量有限，临时文件不作为可恢复备份', async () => {
    await createBackup()
    await createBackup()
    await createBackup()
    await createBackup()
    expect((await listBackups()).filter((entry) => !entry.safety)).toHaveLength(3)
    expect((await listBackups()).some((entry) => entry.id.endsWith('.tmp'))).toBe(false)
  })
  it('恢复最旧备份时，即使安全快照触发清理也保留选中内容', async () => {
    setSetting('backupRetention', 1)
    const oldest = await createBackup()
    setSetting('backupRetention', 3)
    await createBackup()
    await createBackup()
    setSetting('backupRetention', 1)
    await expect(scheduleRestore(oldest.id)).resolves.toBeUndefined()
    expect(() => validateDatabase(join(mock.dir, 'pending-restore.sqlite'))).not.toThrow()
  })
})
