import { useEffect } from 'react'
import { HashRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { ScanIndicator } from './components/ScanIndicator'
import { HomePage } from './routes/HomePage'
import { LibraryPage } from './routes/LibraryPage'
import { SeriesPage } from './routes/SeriesPage'
import { ReaderPage } from './routes/reader/ReaderPage'
import { SettingsPage } from './routes/SettingsPage'
import { CloudPage } from './routes/CloudPage'

/** 每次应用会话只自动恢复一次：effect 因任何原因重跑（StrictMode/HMR）都不再二次推入 */
let resumedInSession = false

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

export default function App() {
  return (
    <HashRouter>
      <LaunchResume />
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/series/:id" element={<SeriesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/cloud" element={<CloudPage />} />
        </Route>
        <Route path="/reader/:chapterId" element={<ReaderPage />} />
      </Routes>
      <ScanIndicator />
    </HashRouter>
  )
}
