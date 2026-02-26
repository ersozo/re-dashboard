import React, { useState, useMemo, useRef, useEffect } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { useTheme } from '../../hooks/useTheme'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)


const CHART_COLORS = [
    "#60A5FA",  // muted blue
    "#34D399",  // muted green
    "#F59E0B",  // muted amber
    "#A78BFA",  // muted violet
    "#2DD4BF",  // muted teal
    "#F87171",  // muted red (non-alert usage)
    "#818CF8",  // muted indigo
    "#94A3B8",  // cool gray-blue
]

/**
 * Normalize data from two possible shapes:
 *  - REST /report-data  →  { units: { "Final 1A": {...}, ... }, summary: {...} }
 *  - WebSocket array    →  [ { unit_name, models, summary: {...} }, ... ]
 *
 * Returns { unitMap, globalSummary } where unitMap is keyed by unit name.
 */
function normalizeReportData(raw) {
  if (!raw) return null

  // REST shape: has "units" object
  if (raw.units && typeof raw.units === 'object' && !Array.isArray(raw.units)) {
    const unitMap = {}
    for (const [name, u] of Object.entries(raw.units)) {
      unitMap[name] = {
        totalSuccess: u.total_success ?? 0,
        totalFail: u.total_fail ?? 0,
        quality: (u.quality ?? 0) * 100,
        performance: (u.performance_sum ?? 0) * 100,
        models: u.models ?? [],
      }
    }
    const s = raw.summary ?? {}
    return {
      unitMap,
      globalSummary: {
        totalSuccess: s.total_success ?? 0,
        totalFail: s.total_fail ?? 0,
        quality: (s.weighted_quality ?? 0) * 100,
        performance: (s.weighted_performance ?? 0) * 100,
      },
    }
  }

  // WebSocket array shape
  if (Array.isArray(raw)) {
    const unitMap = {}
    let totalSuccess = 0
    let totalFail = 0
    let qualityWeighted = 0
    let totalProcessed = 0
    let perfWeighted = 0
    let perfDenom = 0

    for (const unit of raw) {
      const s = unit.summary ?? unit
      const success = s.total_success ?? 0
      const fail = s.total_fail ?? 0
      const processed = success + fail
      const q = (s.total_quality ?? 0) * 100
      const perfSum = s.unit_performance_sum ?? s.total_performance ?? 0
      const p = perfSum * 100

      unitMap[unit.unit_name] = {
        totalSuccess: success,
        totalFail: fail,
        quality: q,
        performance: p,
        models: unit.models ?? [],
      }

      totalSuccess += success
      totalFail += fail
      qualityWeighted += (s.total_quality ?? 0) * processed
      totalProcessed += processed
      if (success > 0) {
        perfWeighted += perfSum * success
        perfDenom += success
      }
    }

    return {
      unitMap,
      globalSummary: {
        totalSuccess,
        totalFail,
        quality: totalProcessed > 0 ? (qualityWeighted / totalProcessed) * 100 : 0,
        performance: perfDenom > 0 ? (perfWeighted / perfDenom) * 100 : 0,
      },
    }
  }

  return null
}

const SORT_CARDS = [
  { metric: 'totalSuccess', label: 'Toplam Üretim', bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-800 dark:text-yellow-300', activeBorder: 'border-yellow-500 dark:border-yellow-400' },
  { metric: 'totalFail', label: 'Toplam Tamir', bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-800 dark:text-red-300', activeBorder: 'border-red-500 dark:border-red-400' },
  { metric: 'quality', label: 'Kalite (%)', bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-800 dark:text-green-300', activeBorder: 'border-green-500 dark:border-green-400' },
  { metric: 'performance', label: 'OEE (%)', bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-800 dark:text-blue-300', activeBorder: 'border-blue-500 dark:border-blue-400' },
]

const ReportView = ({ data, isLive, dataVersion }) => {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const [flashing, setFlashing] = useState(false)
  const [sortMetric, setSortMetric] = useState('totalSuccess')
  const [sortOrder, setSortOrder] = useState('desc')
  const prevVersionRef = useRef(dataVersion)

  useEffect(() => {
    if (isLive && dataVersion > 0 && dataVersion !== prevVersionRef.current) {
      prevVersionRef.current = dataVersion
      setFlashing(true)
      const timer = setTimeout(() => setFlashing(false), 1000)
      return () => clearTimeout(timer)
    }
  }, [dataVersion, isLive])

  const normalized = useMemo(() => normalizeReportData(data), [data])

  if (!normalized) return null

  const { unitMap, globalSummary } = normalized

  // Sort unit names by the selected metric
  const sortedUnitNames = useMemo(() => {
    const names = Object.keys(unitMap)
    return names.sort((a, b) => {
      const aVal = unitMap[a]?.[sortMetric] ?? 0
      const bVal = unitMap[b]?.[sortMetric] ?? 0
      return sortOrder === 'desc' ? bVal - aVal : aVal - bVal
    })
  }, [unitMap, sortMetric, sortOrder])

  if (sortedUnitNames.length === 0) return null

  const handleSortClick = (metric) => {
    if (sortMetric === metric) {
      setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')
    } else {
      setSortMetric(metric)
      setSortOrder('desc')
    }
  }

  const getCardValue = (metric) => {
    switch (metric) {
      case 'totalSuccess': return globalSummary.totalSuccess.toLocaleString()
      case 'totalFail': return globalSummary.totalFail.toLocaleString()
      case 'quality': return `${globalSummary.quality.toFixed(0)}`
      case 'performance': return `${globalSummary.performance.toFixed(0)}`
      default: return '-'
    }
  }

  return (
    <div className="space-y-8">
      {/* Summary cards — clickable for sorting */}
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow dark:shadow-slate-700/10 p-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-4">Üretim Özeti</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {SORT_CARDS.map((card) => (
            <SummaryCard
              key={card.metric}
              label={card.label}
              value={getCardValue(card.metric)}
              bg={card.bg}
              text={card.text}
              flashing={flashing}
              dataVersion={dataVersion}
              isActive={sortMetric === card.metric}
              activeBorder={card.activeBorder}
              sortOrder={sortMetric === card.metric ? sortOrder : null}
              onClick={() => handleSortClick(card.metric)}
            />
          ))}
        </div>
      </div>

      {/* 4 charts in 2x2 grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DrilldownChart
          chartId="production"
          title="Toplam Üretim"
          unitNames={sortedUnitNames}
          unitMap={unitMap}
          metric="totalSuccess"
          modelMetric="success_qty"
          modelLabel="Model Üretim"
          isDark={isDark}
        />
        <DrilldownChart
          chartId="performance"
          title="OEE (%)"
          unitNames={sortedUnitNames}
          unitMap={unitMap}
          metric="performance"
          modelMetric="performance"
          isPercent
          modelLabel="Model OEE (%)"
          isDark={isDark}
        />
        <DrilldownChart
          chartId="fail"
          title="Toplam Tamir"
          unitNames={sortedUnitNames}
          unitMap={unitMap}
          metric="totalFail"
          modelMetric="fail_qty"
          modelLabel="Model Tamir"
          isDark={isDark}
        />
        <DrilldownChart
          chartId="quality"
          title="Kalite (%)"
          unitNames={sortedUnitNames}
          unitMap={unitMap}
          metric="quality"
          modelMetric="quality"
          isPercent
          capAt100
          modelLabel="Model Kalite (%)"
          isDark={isDark}
        />
      </div>
    </div>
  )
}

const SummaryCard = ({ label, value, bg, text, flashing, dataVersion, isActive, activeBorder, sortOrder, onClick }) => (
  <div
    key={`card-${dataVersion}`}
    onClick={onClick}
    className={`${bg} p-4 rounded-lg text-center relative cursor-pointer transition-all select-none
      ${flashing ? 'animate-flash-update' : ''}
      ${isActive ? `border-2 ${activeBorder} ring-1 ring-blue-300 dark:ring-blue-600` : 'border-2 border-transparent'}
      hover:scale-[1.02] hover:shadow-md`}
  >
    <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
    <p className={`text-2xl font-bold ${text}`}>{value}</p>
    {isActive && (
      <span className="absolute top-2 right-2 text-base font-bold text-blue-600 dark:text-blue-400">
        {sortOrder === 'desc' ? '↓' : '↑'}
      </span>
    )}
  </div>
)

/**
 * A single bar chart with drill-down support.
 * Click a unit bar → shows model-level detail. "← Geri" button to return.
 */
const DrilldownChart = ({
  chartId,
  title,
  unitNames,
  unitMap,
  metric,
  modelMetric,
  isPercent,
  capAt100,
  modelLabel,
  isDark,
}) => {
  const [drillUnit, setDrillUnit] = useState(null)
  const chartRef = useRef(null)

  // Reset drill-down when underlying data changes (e.g. live update)
  const dataKey = unitNames.join('|')
  const prevDataKeyRef = useRef(dataKey)
  useEffect(() => {
    // Only reset if units changed, not on metric value updates
    if (prevDataKeyRef.current !== dataKey) {
      setDrillUnit(null)
      prevDataKeyRef.current = dataKey
    }
  }, [dataKey])

  const isInDrilldown = drillUnit !== null

  // Build chart data
  const chartData = useMemo(() => {
    if (!isInDrilldown) {
      // Unit-level view
      return {
        labels: unitNames,
        datasets: [{
          label: title,
          data: unitNames.map(u => unitMap[u]?.[metric] ?? 0),
          backgroundColor: CHART_COLORS.slice(0, unitNames.length),
          borderColor: CHART_COLORS.slice(0, unitNames.length),
          borderWidth: 1,
        }],
      }
    }

    // Model-level drill-down
    const unit = unitMap[drillUnit]
    if (!unit || !unit.models || unit.models.length === 0) {
      return { labels: [], datasets: [{ label: modelLabel, data: [], backgroundColor: [], borderColor: [], borderWidth: 1 }] }
    }

    const models = unit.models.map(m => {
      const name = m.model_name || m.model || 'Unknown'
      let value = 0

      if (modelMetric === 'quality') {
        const processed = (m.success_qty || 0) + (m.fail_qty || 0)
        value = processed > 0 ? ((m.success_qty || 0) / processed) * 100 : 0
      } else if (modelMetric === 'performance') {
        value = m.performance != null ? m.performance * 100 : 0
      } else {
        value = m[modelMetric] ?? 0
      }

      return { name, value }
    })

    models.sort((a, b) => b.value - a.value)

    return {
      labels: models.map(m => m.name),
      datasets: [{
        label: `${drillUnit} - ${modelLabel}`,
        data: models.map(m => m.value),
        backgroundColor: CHART_COLORS.slice(0, models.length),
        borderColor: CHART_COLORS.slice(0, models.length),
        borderWidth: 1,
      }],
    }
  }, [isInDrilldown, unitNames, unitMap, drillUnit, metric, modelMetric, title, modelLabel])

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        beginAtZero: true,
        ...(isPercent && capAt100 ? { max: 100 } : {}),
        suggestedMax: isPercent ? 100 : undefined,
        grid: { color: isDark ? '#334155' : '#f3f4f6' },
        ticks: {
          color: isDark ? '#94a3b8' : undefined,
          font: { size: 11 },
          ...(isPercent ? { callback: (v) => v + '%' } : { stepSize: 1 }),
        },
      },
      x: {
        grid: { display: false },
        ticks: {
          color: isDark ? '#94a3b8' : undefined,
          font: { size: 11 },
        },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: isDark ? 'rgba(30,41,59,0.95)' : 'rgba(255,255,255,0.95)',
        titleColor: isDark ? '#e2e8f0' : '#1f2937',
        bodyColor: isDark ? '#94a3b8' : '#4b5563',
        borderColor: isDark ? '#334155' : '#e5e7eb',
        borderWidth: 1,
        padding: 10,
      },
    },
    onClick: (_event, elements) => {
      if (!isInDrilldown && elements.length > 0) {
        const idx = elements[0].index
        const unitName = unitNames[idx]
        if (unitName) setDrillUnit(unitName)
      }
    },
  }), [isDark, isPercent, isInDrilldown, unitNames])

  const displayTitle = isInDrilldown ? `${drillUnit} - ${title} Detayı` : title

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow dark:shadow-slate-700/10 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{displayTitle}</h3>
        {isInDrilldown && (
          <button
            onClick={() => setDrillUnit(null)}
            className="px-3 py-1 text-sm bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
          >
            ← Geri
          </button>
        )}
      </div>
      <div className="h-[400px]">
        <Bar ref={chartRef} data={chartData} options={options} />
      </div>
    </div>
  )
}

export default ReportView
