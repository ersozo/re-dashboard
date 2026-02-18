import React from 'react'
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom'
import { ThemeProvider } from './hooks/useTheme'
import Dashboard from './components/Dashboard'
import Settings from './components/Settings'
import Navbar from './components/Navbar'
import HourlySignage from './components/views/HourlySignage'

const SIGNAGE_ROUTES = ['/hourly']

function AppLayout() {
  const location = useLocation()
  const isSignage = SIGNAGE_ROUTES.includes(location.pathname)

  if (isSignage) {
    return (
      <Routes>
        <Route path="/hourly" element={<HourlySignage />} />
      </Routes>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex flex-col transition-colors">
      <Navbar />
      <main className="flex-1 container mx-auto px-4 py-8">
        <Routes>
          <Route path="/" element={<Settings />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/report" element={<Dashboard view="report" />} />
        </Routes>
      </main>
    </div>
  )
}

function App() {
  return (
    <ThemeProvider>
      <Router>
        <AppLayout />
      </Router>
    </ThemeProvider>
  )
}

export default App
