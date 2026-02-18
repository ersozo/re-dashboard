import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Settings as SettingsIcon, Sun, Moon } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'

const Navbar = () => {
  const location = useLocation()
  const { theme, toggleTheme } = useTheme()

  const isActive = (path) => location.pathname === path

  const queryParams = new URLSearchParams(location.search)
  const isLive = queryParams.get('isLive') === 'true'
  const isViewPage = ['/dashboard', '/report'].includes(location.pathname)
  const showBadge = isViewPage

  return (
    <nav className="bg-white dark:bg-slate-800 shadow-md dark:shadow-slate-700/20">
      <div className="container mx-auto px-4">
        <div className="flex justify-between items-center h-16">
          <div className="text-3xl font-bold text-blue-600 dark:text-blue-400 flex items-center">
            <span className="mr-2">📊</span>
            Üretim Takip
          </div>

          <div className="flex items-center space-x-3">
            {isViewPage && (
              <NavLink to="/" active={false} icon={<SettingsIcon size={18} />}>
                Ana Sayfa
              </NavLink>
            )}

            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {showBadge && (
              isLive ? (
                <div className="px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full text-xs font-medium flex items-center">
                  <span className="h-2 w-2 mr-2 rounded-full bg-green-500 animate-pulse"></span>
                  Canlı Veri
                </div>
              ) : (
                <div className="px-3 py-1 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 rounded-full text-xs font-medium flex items-center">
                  <span className="h-2 w-2 mr-2 rounded-full bg-gray-500"></span>
                  Geçmiş Veri
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}

const NavLink = ({ to, children, active, icon }) => (
  <Link
    to={to}
    className={`flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors ${
      active
        ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 hover:text-blue-600 dark:hover:text-blue-400'
    }`}
  >
    {icon && <span className="mr-2">{icon}</span>}
    {children}
  </Link>
)

export default Navbar
