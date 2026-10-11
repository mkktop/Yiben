import { useState } from 'react'
import { Card, CardBody, CardHeader } from './ui/card'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { useAsync } from '@/hooks/useAsync'
import { useDataStore } from '@/stores/data'
import { errorMessage } from '@/lib/utils'
import type { Library } from '@shared/types'

export function WebDavSection() {
  const version = useDataStore((state) => state.version)
  const [name, setName] = useState('WebDAV 书库')
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const { data } = useAsync<Library[]>(() => window.yudu.libraries.list(), [version])
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      await fn()
      useDataStore.getState().bump()
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <CardHeader title="WebDAV / NAS 书库" />
      <CardBody>
        <p className="text-xs text-muted-foreground">
          输入漫画根目录的 WebDAV 地址，连接后自动扫描；支持散图、压缩包、PDF 和离线缓存。
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            aria-label="WebDAV 书库名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="书库名称"
          />
          <Input
            aria-label="WebDAV 地址"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://nas.example.com/dav/comics/"
          />
          <Input
            aria-label="WebDAV 用户名"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="用户名"
          />
          <Input
            aria-label="WebDAV 密码"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="密码 / 应用密码"
          />
        </div>
        <Button
          size="sm"
          disabled={busy || !url.trim()}
          onClick={() =>
            void run(async () => {
              await window.yudu.webdav.add({ name, url, username, password })
              setPassword('')
              setMessage('连接成功，正在扫描')
            })
          }
        >
          验证并添加书库
        </Button>
        {(data ?? [])
          .filter((lib) => lib.kind === 'webdav')
          .map((lib) => (
            <div key={lib.id} className="flex items-center justify-between gap-3 text-sm">
              <span>{lib.name}</span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run(() => window.yudu.libraries.rescan(lib.id))}
                >
                  重扫
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm('移除此 WebDAV 书库及其阅读数据？服务器文件不会被删除。'))
                      void run(() => window.yudu.libraries.remove(lib.id))
                  }}
                >
                  移除
                </Button>
              </div>
            </div>
          ))}
        {message && <p className="text-xs text-muted-foreground">{message}</p>}
      </CardBody>
    </Card>
  )
}
