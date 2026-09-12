import { useEffect } from 'react'
import { HashRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { ScanIndicator } from './components/ScanIndicator'
import { CloudNoticeToast } from './components/CloudNoticeToast'
import { HomePage } from './routes/HomePage'
import { LibraryPage } from './routes/LibraryPage'
import { SeriesPage } from './routes/SeriesPage'
import { ReaderPage } from './routes/reader/ReaderPage'
import { SettingsPage } from './routes/SettingsPage'
import { CloudPage } from './routes/CloudPage'
import { StatsPage } from './routes/StatsPage'
import { useUpdateStore } from './stores/update'

/** 每次应用会话只自动恢复一次：effect 因任何原因重跑（StrictMode/HMR）都不再二次推入 */
let resumedInSession = false

/** 每次应用会话只自动检查一次更新（同上，避免 StrictMode/HMR 重复请求） */
let updateCheckedInSession = false

/** 启动自动检查更新：结果只进 store（侧边栏/设置页展示），不打断用户；
 *  dev 模式主进程直接回 dev 状态，不会真的访问网络 */
function UpdateBootstrap() {
  const init = useUpdateStore((s) => s.init)
  const check = useUpdateStore((s) => s.check)
  useEffect(() => {
    void init()
    if (updateCheckedInSession) return
    updateCheckedInSession = true
    void (async () => {
      try {
        const enabled = await window.yiben.config.get('autoCheckUpdate')
        if (enabled === false) return
        await check()
      } catch {
        /* 配置不可读/网络失败都不影响启动 */
      }
    })()
  }, [init, check])
  return null
}

/** 启动恢复：开了开关且有阅读记录时，直接回到上次读到的位置 */
function LaunchResume() {
  const navigate = useNavigate()
  useEffect(() => {
    if (resumedInSession) return
    let cancelled = false
    void (async () => {
      try {
        const resume = await window.yiben.config.get('resumeOnLaunch')
        if (resume === false || cancelled || resumedInSession) return
        const list = await window.yiben.home.continue()
        if (cancelled || resumedInSession || list.length === 0) return
        // 用户（或调试钩子）已经开始导航时不抢跳
        const hash = window.location.hash
        if (hash && hash !== '#/' && hash !== '#') return
        resumedInSession = true
        // 必须 push 而不是 replace：主页要留在历史栈底，阅读器的「返回/Esc」才能回到主页
        navigate(`/reader/${list[0].chapter_id}`)
      } catch {
        /* 配置不可读时按默认（首页）进入 */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [navigate])
  return null
}

/** 双击漫画文件（系统文件关联）打开：主进程解析出章节 id 后进阅读器 */
function OpenFileBridge() {
  const navigate = useNavigate()
  useEffect(() => {
    const open = (chapterId: number | null): void => {
      if (chapterId == null) return
      // 打开文件优先：「启动时恢复上次阅读」必须让位，否则冷启动双击会被抢跳回上一话
      resumedInSession = true
      navigate(`/reader/${chapterId}`)
    }
    // 冷启动暂存的章节可能在组件挂载前就广播过，先领取一次再挂监听
    void window.yiben.openFile.take().then(open)
    return window.yiben.events.onOpenFile(({ chapterId }) => open(chapterId))
  }, [navigate])
  return null
}

export default function App() {
  return (
    <HashRouter>
      <LaunchResume />
      <OpenFileBridge />
      <UpdateBootstrap />
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/series/:id" element={<SeriesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/cloud" element={<CloudPage />} />
          <Route path="/stats" element={<StatsPage />} />
        </Route>
        <Route path="/reader/:chapterId" element={<ReaderPage />} />
      </Routes>
      <ScanIndicator />
      <CloudNoticeToast />
    </HashRouter>
  )
}
