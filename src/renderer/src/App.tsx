import { HashRouter, Routes, Route } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { ScanIndicator } from './components/ScanIndicator'
import { HomePage } from './routes/HomePage'
import { LibraryPage } from './routes/LibraryPage'
import { SeriesPage } from './routes/SeriesPage'
import { ReaderPage } from './routes/reader/ReaderPage'
import { SettingsPage } from './routes/SettingsPage'
import { CloudPage } from './routes/CloudPage'

export default function App() {
  return (
    <HashRouter>
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
