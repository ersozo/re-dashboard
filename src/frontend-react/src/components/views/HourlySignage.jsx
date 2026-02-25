import React, { useState, useEffect, useRef } from 'react'
import useDashboardData from '../../hooks/useDashboardData'

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

const HourlySignage = () => {
  const { data, loading, lastUpdate, isLive, startTime, endTime, updating, dataVersion } = useDashboardData('hourly')
  const [clock, setClock] = useState('')
  const [currentTime, setCurrentTime] = useState(new Date())
  const [flashing, setFlashing] = useState(false)
  const clockRef = useRef(null)
  const prevVersionRef = useRef(dataVersion)

  // Trigger flash animation when dataVersion changes (live updates)
  useEffect(() => {
    if (isLive && dataVersion > 0 && dataVersion !== prevVersionRef.current) {
      prevVersionRef.current = dataVersion
      setFlashing(true)
      const timer = setTimeout(() => setFlashing(false), 1000)
      return () => clearTimeout(timer)
    }
  }, [dataVersion, isLive])

  // Live clock - updates every second, also keeps currentTime in sync
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const hh = String(now.getHours()).padStart(2, '0')
      const mm = String(now.getMinutes()).padStart(2, '0')
      setClock(`${hh}:${mm}`)
      setCurrentTime(now)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-red-900 flex flex-col items-center justify-center">
        <div className="text-white text-9xl font-bold mb-8">{clock || '--:--'}</div>
        <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
        <p className="text-white text-2xl mt-6 animate-pulse">Veriler hazırlanıyor...</p>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="min-h-screen bg-red-900 flex flex-col items-center justify-center">
        <div className="text-white text-9xl font-bold mb-8">{clock || '--:--'}</div>
        <p className="text-white text-3xl">Veri bulunamadı</p>
      </div>
    )
  }

  // Grid: 1 col for single unit, 2 cols for multiple
  const gridCols = data.length === 1 ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'

  return (
    <div className="min-h-screen bg-red-900 overflow-x-hidden">
      <div className="container mx-auto px-2 max-w-full">
        {/* Header: live clock or static title for historical */}
        <div className="text-center my-2">
          {isLive ? (
            <h2 ref={clockRef} className="text-6xl sm:text-7xl md:text-8xl lg:text-9xl font-bold text-white">
              {clock}
            </h2>
          ) : (
            <h2 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-white uppercase">
              SAATLİK ÜRETİM SAYILARI
            </h2>
          )}
        </div>

        {/* Top-right indicator: live update time or historical date range */}
        {isLive ? (
          <div className={`fixed top-4 right-4 text-white px-4 py-2 rounded-lg text-md z-50 transition-colors duration-300 ${updating ? 'bg-blue-600/90' : 'bg-gray-600/80'}`}>
            {updating ? (
              <>
                <span className="inline-block h-2 w-2 rounded-full bg-white mr-2 animate-pulse"></span>
                Güncelleniyor...
              </>
            ) : (
              <>
                <span className="inline-block h-2 w-2 rounded-full bg-green-500 mr-2 animate-pulse"></span>
                {lastUpdate ? lastUpdate.toLocaleTimeString() : '...'}
              </>
            )}
          </div>
        ) : (
          startTime && endTime && (
            <div className="fixed top-4 right-4 bg-gray-600/80 text-white px-4 py-2 rounded-lg text-md z-50">
              <span className="mr-2">📊</span>Geçmiş Veri: {formatDateTime(startTime)} — {formatDateTime(endTime)}
            </div>
          )
        )}

        {/* Unit cards grid */}
        <div className={`grid ${gridCols} gap-4 w-full`}>
          {data.map((unitData, idx) => (
            <UnitSignageCard key={unitData.unit_name || idx} unitData={unitData} currentTime={currentTime} flashing={flashing} dataVersion={dataVersion} />
          ))}
        </div>
      </div>
    </div>
  )
}


const formatTime = (date) => {
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

const UnitSignageCard = ({ unitData, currentTime, flashing, dataVersion }) => {
  const { unit_name, hourly_data, total_success, total_theoretical_qty } = unitData

  // Short name: "1A" from "Final 1A"
  const shortName = unit_name?.includes(' ') ? unit_name.split(' ').pop() : unit_name

  // Theoretical display
  const targetDisplay = total_theoretical_qty > 0
    ? Math.round(total_theoretical_qty).toLocaleString()
    : '-'

  // Flash class applied when data updates
  const flashClass = flashing ? 'animate-flash-green' : ''

  // Sort hourly data: newest first (reverse chronological)
  const sortedHours = [...(hourly_data || [])].sort((a, b) => {
    return new Date(b.hour_start) - new Date(a.hour_start)
  })

  const now = currentTime

  return (
    <div className="bg-white rounded-lg shadow p-2 w-full">
      {/* Summary header */}
      <div className="w-full mb-1">
        <table className="w-full" style={{ tableLayout: 'fixed' }}>
          <tbody>
            <tr>
              {/* Production total */}
              <td className="p-0 w-1/2">
                <div className="text-white text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-7xl font-bold text-center p-2 bg-red-900 rounded-tl-lg truncate">
                  {shortName} ÜRETİM
                </div>
                <div key={`prod-${dataVersion}`} className={`text-4xl sm:text-5xl md:text-6xl lg:text-8xl xl:text-9xl font-bold text-center p-2 bg-yellow-200 ${flashClass}`}>
                  {(total_success || 0).toLocaleString()}
                </div>
              </td>
              {/* Target total */}
              <td className="p-0 w-1/2">
                <div className="text-white text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-7xl font-bold text-center p-2 bg-red-900 rounded-tr-lg">
                  HEDEF
                </div>
                <div key={`target-${dataVersion}`} className={`text-4xl sm:text-5xl md:text-6xl lg:text-8xl xl:text-9xl font-bold text-center p-2 bg-green-200 ${flashClass}`}>
                  {targetDisplay}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Hourly table */}
      <table className="w-full divide-y divide-gray-200">
        <thead className="bg-gray-300">
          <tr>
            <th className="px-1 py-2 text-center font-bold text-black text-lg sm:text-xl md:text-2xl lg:text-3xl xl:text-5xl tracking-wider w-[35%]">Saat</th>
            <th className="px-1 py-2 text-center font-bold text-black text-lg sm:text-xl md:text-2xl lg:text-3xl xl:text-5xl tracking-wider w-[22%]">Üretim</th>
            <th className="px-1 py-2 text-center font-bold text-black text-lg sm:text-xl md:text-2xl lg:text-3xl xl:text-5xl tracking-wider w-[21%]">Tamir</th>
            <th className="px-1 py-2 text-center font-bold text-black text-lg sm:text-xl md:text-2xl lg:text-3xl xl:text-5xl tracking-wider w-[22%]">Hedef</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {sortedHours.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-2 py-4 text-center text-gray-500 text-xl">
                Bu birim için veri bulunamadı
              </td>
            </tr>
          ) : (
            sortedHours.map((hour, idx) => {
              const startDt = new Date(hour.hour_start)
              const endDt = new Date(hour.hour_end)
              const isCurrent = startDt <= now && now < endDt

              const startLabel = formatTime(startDt)
              const endLabel = isCurrent ? formatTime(now) : formatTime(endDt)
              const hourLabel = `${startLabel} - ${endLabel}`

              const theoretical = hour.theoretical_qty > 0
                ? Math.round(hour.theoretical_qty).toLocaleString()
                : '-'

              return (
                <tr
                  key={hour.hour_start}
                  className={
                    isCurrent
                      ? 'bg-blue-50'
                      : idx % 2 === 0
                        ? 'bg-white'
                        : 'bg-gray-100'
                  }
                >
                  <td className="px-1 py-2 text-center font-bold text-black text-base sm:text-lg md:text-xl lg:text-2xl xl:text-3xl">
                    <div className="flex flex-col items-center">
                      <span>{hourLabel}</span>
                      {isCurrent && (
                        <span className="mt-1 px-2 py-0.5 bg-green-100 text-green-800 text-[10px] sm:text-xs rounded-full animate-pulse">
                          Aktif
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-1 py-2 text-center text-black font-bold text-2xl sm:text-3xl md:text-4xl lg:text-6xl xl:text-7xl">
                    {(hour.success_qty || 0).toLocaleString()}
                  </td>
                  <td className="px-1 py-2 text-center text-red-900 font-bold text-2xl sm:text-3xl md:text-4xl lg:text-6xl xl:text-7xl">
                    {(hour.fail_qty || 0).toLocaleString()}
                  </td>
                  <td className="px-1 py-2 text-center text-black font-bold text-2xl sm:text-3xl md:text-4xl lg:text-6xl xl:text-7xl">
                    {theoretical}
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

export default HourlySignage
