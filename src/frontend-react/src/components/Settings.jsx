import React, { useState, useEffect } from 'react'
// Navigation opens views in new tabs via window.open()
import { Calendar, Clock, Check, ChevronRight, Layout, BarChart, FileText } from 'lucide-react'

const workingModes = {
  mode1: {
    name: '3 Vardiya',
    description: '08:00-16:00, 16:00-24:00, 00:00-08:00',
    shifts: [
      { id: 'shift1', name: '08:00 - 16:00', start: 8, end: 16, crossesMidnight: false },
      { id: 'shift2', name: '16:00 - 24:00', start: 16, end: 24, crossesMidnight: false },
      { id: 'shift3', name: '00:00 - 08:00', start: 0, end: 8, crossesMidnight: false }
    ]
  },
  mode2: {
    name: '2 Vardiya',
    description: '08:00-18:00, 20:00-08:00',
    shifts: [
      { id: 'shift1', name: '08:00 - 18:00', start: 8, end: 18, crossesMidnight: false },
      { id: 'shift2', name: '20:00 - 08:00', start: 20, end: 8, crossesMidnight: true }
    ]
  },
  mode3: {
    name: '2 Vardiya (12 saat)',
    description: '08:00-20:00, 20:00-08:00',
    shifts: [
      { id: 'shift1', name: '08:00 - 20:00', start: 8, end: 20, crossesMidnight: false },
      { id: 'shift2', name: '20:00 - 08:00', start: 20, end: 8, crossesMidnight: true }
    ]
  }
}

const Settings = () => {
  const [units, setUnits] = useState([])
  const [selectedUnits, setSelectedUnits] = useState([])
  const [workingMode, setWorkingMode] = useState('mode1')
  const [selectedShift, setSelectedShift] = useState('shift1')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchUnits()
    initializeDefaults()
  }, [])

  useEffect(() => {
    updateShiftTimes()
  }, [workingMode, selectedShift])

  const fetchUnits = async () => {
    try {
      const response = await fetch('/units')
      if (response.ok) {
        const data = await response.json()
        setUnits(data)
      }
    } catch (error) {
      console.error('Units fetch error:', error)
    } finally {
      setLoading(false)
    }
  }

  const initializeDefaults = () => {
    const now = new Date()
    const currentHour = now.getHours()

    const mode = workingModes['mode1']
    const matchingShift = mode.shifts.find(s => {
      if (s.crossesMidnight) {
        return currentHour >= s.start || currentHour < s.end
      }
      return currentHour >= s.start && currentHour < s.end
    })

    if (matchingShift) {
      setSelectedShift(matchingShift.id)
    }

    setEndTime(formatDateTimeLocal(now))
  }

  const updateShiftTimes = () => {
    const mode = workingModes[workingMode]
    const shift = mode.shifts.find(s => s.id === selectedShift) || mode.shifts[0]

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    let start = new Date(today)

    if (shift.crossesMidnight && now.getHours() < shift.end) {
      start.setDate(start.getDate() - 1)
    }

    start.setHours(shift.start, 0, 0, 0)
    setStartTime(formatDateTimeLocal(start))

    const shiftIsCurrent = shift.crossesMidnight
      ? (now.getHours() >= shift.start || now.getHours() < shift.end)
      : (now.getHours() >= shift.start && now.getHours() < shift.end)

    if (shiftIsCurrent) {
      setEndTime(formatDateTimeLocal(now))
    } else {
      let end = new Date(today)
      if (shift.crossesMidnight && now.getHours() >= shift.start) {
        end.setDate(end.getDate() + 1)
      }
      end.setHours(shift.end, 0, 0, 0)
      setEndTime(formatDateTimeLocal(end))
    }
  }

  const formatDateTimeLocal = (date) => {
    const pad = (n) => n.toString().padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  }

  const handleUnitToggle = (unit) => {
    setSelectedUnits(prev =>
      prev.includes(unit) ? prev.filter(u => u !== unit) : [...prev, unit]
    )
  }

  // Fixed unit layout: two columns
  const unitColumns = [
    [
      { label: 'Final 1', units: ['Final 1A', 'Final 1B'] },
      { label: 'Final 2', units: ['Final 2A', 'Final 2B'] },
      { label: 'Final 3', units: ['Final 3A', 'Final 3A-2', 'Final 3B'] },
    ],
    [
      { label: 'Final 4', units: ['Final 4A', 'Final 4B'] },
      { label: 'Final 5', units: ['Final 5A', 'Final 5B'] },
    ],
  ]

  const allGridUnits = unitColumns.flat().flatMap(g => g.units)
  const selectAllUnits = () => setSelectedUnits([...allGridUnits])
  const deselectAllUnits = () => setSelectedUnits([])

  const isHistorical = () => {
    if (!startTime) return false
    const start = new Date(startTime)
    if (isNaN(start.getTime())) return false

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const startDate = new Date(start)
    startDate.setHours(0, 0, 0, 0)

    return startDate < today
  }

  const handleNavigate = (viewType) => {
    if (selectedUnits.length === 0) {
      alert('Lütfen en az bir üretim yerini seçiniz')
      return
    }

    const live = !isHistorical()

    const params = new URLSearchParams()
    selectedUnits.forEach(u => params.append('units', u))
    params.set('start', new Date(startTime).toISOString())
    params.set('end', new Date(endTime).toISOString())
    params.set('workingMode', workingMode)
    params.set('isLive', live)

    window.open(`/${viewType}?${params.toString()}`, '_blank')
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100 mb-8 px-4">Parametreleri Ayarla</h1> */}

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg dark:shadow-slate-700/10 overflow-hidden">
        {/* Unit Selection */}
        <div className="p-6 border-b border-gray-100 dark:border-slate-700">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200 flex items-center">
              <Layout className="mr-2 text-blue-500" size={20} />
              Üretim Yerleri
            </h2>
            <div className="space-x-2">
              <button
                onClick={selectAllUnits}
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 px-3 py-1 bg-blue-50 dark:bg-blue-900/30 rounded-md transition-colors"
                type="button"
              >
                Tümünü Seç
              </button>
              <button
                onClick={deselectAllUnits}
                className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-600 px-3 py-1 bg-gray-50 dark:bg-slate-700 rounded-md transition-colors"
                type="button"
              >
                Seçimi Kaldır
              </button>
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 gap-4 animate-pulse">
              {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-16 bg-gray-100 dark:bg-slate-700 rounded-lg"></div>)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {unitColumns.map((column, colIdx) => (
                <div key={colIdx} className="space-y-3">
                  {column.map(group => (
                    <div key={group.label} className="p-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg border border-gray-100 dark:border-slate-600">
                      <div className="text-xs font-bold text-gray-400 dark:text-gray-500 mb-2 uppercase tracking-wider">{group.label}</div>
                      <div className="flex flex-wrap gap-3">
                        {group.units.map(unit => (
                          <label key={unit} className="flex items-center cursor-pointer group">
                            <div className="relative">
                              <input
                                type="checkbox"
                                checked={selectedUnits.includes(unit)}
                                onChange={() => handleUnitToggle(unit)}
                                className="sr-only"
                              />
                              <div className={`w-5 h-5 border-2 rounded transition-all flex items-center justify-center ${
                                selectedUnits.includes(unit)
                                  ? 'bg-blue-500 border-blue-500'
                                  : 'border-gray-300 dark:border-slate-500 bg-white dark:bg-slate-600 group-hover:border-blue-400'
                              }`}>
                                {selectedUnits.includes(unit) && <Check size={14} className="text-white" />}
                              </div>
                            </div>
                            <span className={`ml-2 text-sm font-medium transition-colors ${
                              selectedUnits.includes(unit) ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400 group-hover:text-gray-700 dark:group-hover:text-gray-200'
                            }`}>
                              {unit}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Working Mode */}
        <div className="p-6 border-b border-gray-100 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center">
            <Clock className="mr-2 text-blue-500" size={20} />
            Çalışma Düzeni
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {Object.entries(workingModes).map(([modeId, mode]) => (
              <button
                key={modeId}
                onClick={() => setWorkingMode(modeId)}
                className={`text-left p-4 rounded-xl border-2 transition-all ${
                  workingMode === modeId
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-100 dark:border-slate-600 bg-white dark:bg-slate-700 hover:border-blue-200 dark:hover:border-blue-700'
                }`}
              >
                <div className={`font-bold text-sm ${workingMode === modeId ? 'text-blue-700 dark:text-blue-400' : 'text-gray-700 dark:text-gray-200'}`}>
                  {mode.name}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                  {mode.description}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Shift Selection */}
        <div className="p-6 border-b border-gray-100 dark:border-slate-700">
          <h3 className="text-sm font-bold text-gray-400 dark:text-gray-500 mb-3 uppercase tracking-wider">Vardiya</h3>
          <div className="flex flex-wrap gap-2">
            {workingModes[workingMode].shifts.map(shift => (
              <button
                key={shift.id}
                onClick={() => setSelectedShift(shift.id)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  selectedShift === shift.id
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-white dark:bg-slate-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500'
                }`}
              >
                {shift.name}
              </button>
            ))}
          </div>
        </div>

        {/* Time Pickers */}
        <div className="p-6 bg-gray-50/50 dark:bg-slate-700/30">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Başlangıç</label>
              <div className="relative">
                <input
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg py-2.5 px-4 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Bitiş</label>
              <div className="relative">
                <input
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg py-2.5 px-4 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-sm"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="p-8">
          <div className="flex items-center justify-between mb-8 pb-4 border-b border-gray-100 dark:border-slate-700">
            <div className="flex items-center">
              {!isHistorical() ? (
                <div className="flex items-center">
                  <div className="relative mr-4 flex items-center justify-center">
                    <div className="h-4 w-4 rounded-full bg-green-500 animate-pulse relative z-10"></div>
                    <div className="absolute h-8 w-8 rounded-full bg-green-400/20 animate-ping"></div>
                  </div>
                  <div>
                    <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-400">Görüntüle</span>
                    <p className="text-[10px] font-black text-green-600 dark:text-green-400 uppercase tracking-[0.2em] mt-0.5">CANLI İZLEME AKTİF</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center">
                  <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg mr-4 text-blue-600 dark:text-blue-400">
                    <Calendar size={20} strokeWidth={2.5} />
                  </div>
                  <div>
                    <span className="text-xl font-bold text-gray-800 dark:text-gray-100">Görüntüle</span>
                    <p className="text-[10px] font-black text-blue-600/60 dark:text-blue-400/60 uppercase tracking-[0.2em] mt-0.5">GEÇMİŞ VERİ ANALİZİ</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <ActionButton
              onClick={() => handleNavigate('hourly')}
              icon={<BarChart size={18} />}
              label="Ekrana Yansıt"
              color="blue"
              isHistorical={isHistorical()}
            />
            <ActionButton
              onClick={() => handleNavigate('dashboard')}
              icon={<Layout size={18} />}
              label="Model Dağılımı"
              color="green"
              isHistorical={isHistorical()}
            />
            <ActionButton
              onClick={() => handleNavigate('report')}
              icon={<FileText size={18} />}
              label="Rapor"
              color="purple"
              isHistorical={isHistorical()}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

const ActionButton = ({ onClick, icon, label, color, isHistorical }) => {
  const colors = {
    blue: isHistorical
      ? 'border-blue-200 dark:border-blue-800/50 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20'
      : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/20',
    green: isHistorical
      ? 'border-green-200 dark:border-green-800/50 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20'
      : 'bg-green-600 hover:bg-green-700 text-white shadow-lg shadow-green-500/20',
    purple: isHistorical
      ? 'border-purple-200 dark:border-purple-800/50 text-purple-700 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20'
      : 'bg-purple-600 hover:bg-purple-700 text-white shadow-lg shadow-purple-500/20',
  }

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between p-5 rounded-2xl font-bold transition-all duration-300 group ${
        isHistorical ? 'border-2' : ''
      } ${colors[color]}`}
    >
      <div className="flex items-center">
        <span className={`mr-4 p-2.5 rounded-xl ${isHistorical ? 'bg-white dark:bg-slate-800 shadow-sm' : 'bg-white/20'} transition-all group-hover:scale-110 group-hover:rotate-3`}>
          {React.cloneElement(icon, { size: 20 })}
        </span>
        <span className="text-base tracking-tight">{label}</span>
      </div>
      <ChevronRight size={18} className={`${isHistorical ? 'text-gray-300' : 'text-white/50'} group-hover:translate-x-1 transition-transform`} />
    </button>
  )
}

export default Settings
