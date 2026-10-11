import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToastStore } from '@/stores/toast'
import type { CloudNotice } from '@shared/types'

/** 云通知在全局 Toast 队列里的固定槽位 */
const SLOT = 'cloud-notice'

/**
 * 云端风控/会话失效的全局提示（无自绘 UI，推入 useToastStore 由 ToastHost 堆叠展示）。
 * - 会话失效（error 态）：常驻，提供「去网盘页」重新登录入口
 * - 触发限流（warning 态）：8 秒自动消失，提示稍后再试
 */
export function CloudNoticeToast() {
  const navigate = useNavigate()
  const push = useToastStore((s) => s.push)
  const close = useToastStore((s) => s.close)
  const [notice, setNotice] = useState<CloudNotice | null>(null)

  useEffect(() => {
    return window.yudu.events.onCloudNotice((payload) => {
      setNotice(payload)
    })
  }, [])

  useEffect(() => {
    if (!notice || notice.kind === 'session') return
    const timer = setTimeout(() => setNotice(null), 8000)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!notice) {
      close(SLOT)
      return
    }
    const isSession = notice.kind === 'session'
    push({
      id: SLOT,
      kind: isSession ? 'error' : 'warning',
      title: isSession ? '云端会话失效' : '触发限流',
      children: (
        <>
          <p className="break-words">{notice.message}</p>
          {isSession && (
            <button
              className="mt-1.5 text-primary underline underline-offset-2"
              onClick={() => {
                setNotice(null)
                navigate('/cloud')
              }}
            >
              去网盘页重新连接
            </button>
          )}
        </>
      )
    })
  }, [notice, push, close, navigate])

  return null
}
