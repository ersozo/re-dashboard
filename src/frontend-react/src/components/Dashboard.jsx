import React from 'react'
import useDashboardData from '../hooks/useDashboardData'
import StandardView from './views/StandardView'
import ReportView from './views/ReportView'
import LoadingScreen from './LoadingScreen'
import ErrorScreen from './ErrorScreen'

const formatDateTime = (isoStr) => {
  if (!isoStr) return ''
  try {
    const d = new Date(isoStr)
    return d.toLocaleString('tr-TR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  } catch {
    return isoStr
  }
}

const Dashboard = ({ view = 'standard' }) => {
  const { data, loading, error, lastUpdate, isLive, units, startTime, endTime, updating, dataVersion } = useDashboardData(view)

  if (loading && !data) return <LoadingScreen />
  if (error) return <ErrorScreen error={error} />

  const renderView = () => {
    switch (view) {
      case 'report':
        return <ReportView data={data} isLive={isLive} lastUpdate={lastUpdate} dataVersion={dataVersion} />
      default:
        return <StandardView data={data} isLive={isLive} lastUpdate={lastUpdate} dataVersion={dataVersion} />
    }
  }

  const viewTitle = view === 'hourly'
    ? 'Saatlik Performans'
    : view === 'report'
      ? 'Üretim Raporu'
      : 'Model Dağılımı'

  const historicalSuffix = !isLive ? ' - Geçmiş Veri' : ''

  return (
    <div className="flex flex-col space-y-6">
      <div className="flex justify-between items-center bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm dark:shadow-slate-700/10">
        <div className="flex items-center space-x-4">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">
            {viewTitle}{historicalSuffix}
          </h2>
          <div className="flex flex-wrap gap-2">
            {units.map(unit => (
              <span key={unit} className="px-2 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded text-xs font-bold border border-blue-100 dark:border-blue-800">
                {unit}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center space-x-4">
          {isLive ? (
            <>
              <div className="flex items-center text-green-600 dark:text-green-400 text-sm font-medium">
                <span className="h-2 w-2 bg-green-500 rounded-full mr-2 animate-pulse"></span>
                Canlı
              </div>
              {updating ? (
                <div className="flex items-center px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-full text-xs font-medium">
                  <span className="h-2 w-2 mr-2 rounded-full bg-blue-500 animate-pulse"></span>
                  Güncelleniyor...
                </div>
              ) : lastUpdate ? (
                <div className="text-xs text-gray-400 dark:text-gray-500">
                  Son Güncelleme: {lastUpdate.toLocaleTimeString()}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="flex items-center px-3 py-1 bg-gray-100 dark:bg-slate-700 text-gray-800 dark:text-gray-300 rounded-full text-sm font-medium">
                <span className="h-2 w-2 mr-2 rounded-full bg-gray-500"></span>
                Geçmiş
              </div>
              {startTime && endTime && (
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {formatDateTime(startTime)} — {formatDateTime(endTime)}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {renderView()}
    </div>
  )
}

export default Dashboard
