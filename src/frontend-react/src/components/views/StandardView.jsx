import React, { useState, useEffect, useRef } from 'react'

const StandardView = ({ data, isLive, dataVersion }) => {
  const [flashing, setFlashing] = useState(false)
  const prevVersionRef = useRef(dataVersion)

  useEffect(() => {
    if (isLive && dataVersion > 0 && dataVersion !== prevVersionRef.current) {
      prevVersionRef.current = dataVersion
      setFlashing(true)
      const timer = setTimeout(() => setFlashing(false), 1000)
      return () => clearTimeout(timer)
    }
  }, [dataVersion, isLive])
  if (!data || data.length === 0) return null

  // Aggregate summary across all units
  const aggregate = data.reduce(
    (acc, unit) => {
      const s = unit.summary || unit
      const success = s.total_success ?? 0
      const fail = s.total_fail ?? 0
      const processed = success + fail
      const quality = s.total_quality ?? 0
      const performance = s.total_performance ?? 0

      acc.totalSuccess += success
      acc.totalFail += fail
      acc.qualityWeighted += quality * processed
      acc.totalProcessed += processed

      if (performance > 0 && success > 0) {
        acc.perfWeighted += performance * success
        acc.perfDenom += success
      }

      return acc
    },
    { totalSuccess: 0, totalFail: 0, qualityWeighted: 0, totalProcessed: 0, perfWeighted: 0, perfDenom: 0 }
  )

  const overallQuality = aggregate.totalProcessed > 0
    ? (aggregate.qualityWeighted / aggregate.totalProcessed) * 100
    : 0
  const overallPerformance = aggregate.perfDenom > 0
    ? (aggregate.perfWeighted / aggregate.perfDenom) * 100
    : 0

  return (
    <div className="space-y-8">
      {/* Summary cards */}
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow dark:shadow-slate-700/10 p-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-4">Üretim Özeti</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <SummaryCard label="Toplam Üretim" value={aggregate.totalSuccess.toLocaleString()} bg="bg-yellow-100 dark:bg-yellow-900/30" text="text-yellow-800 dark:text-yellow-300" flashing={flashing} dataVersion={dataVersion} />
          <SummaryCard label="Toplam Tamir" value={aggregate.totalFail.toLocaleString()} bg="bg-red-100 dark:bg-red-900/30" text="text-red-800 dark:text-red-300" flashing={flashing} dataVersion={dataVersion} />
          <SummaryCard label="Kalite (%)" value={overallQuality.toFixed(0)} bg="bg-green-100 dark:bg-green-900/30" text="text-green-800 dark:text-green-300" flashing={flashing} dataVersion={dataVersion} />
          <SummaryCard label="OEE (%)" value={overallPerformance.toFixed(0)} bg="bg-blue-100 dark:bg-blue-900/30" text="text-blue-800 dark:text-blue-300" flashing={flashing} dataVersion={dataVersion} />
        </div>
      </div>

      {/* Per-unit tables */}
      {data.map((unitData, idx) => (
        <UnitTable key={unitData.unit_name || idx} unitData={unitData} flashing={flashing} dataVersion={dataVersion} />
      ))}
    </div>
  )
}

const SummaryCard = ({ label, value, bg, text, flashing, dataVersion }) => (
  <div key={`card-${dataVersion}`} className={`${bg} p-4 rounded-lg text-center ${flashing ? 'animate-flash-update' : ''}`}>
    <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
    <p className={`text-2xl font-bold ${text}`}>{value}</p>
  </div>
)

const UnitTable = ({ unitData, flashing, dataVersion }) => {
  const { unit_name, models } = unitData
  const summary = unitData.summary || unitData

  const totalSuccess = models
    ? models.reduce((sum, m) => sum + (m.success_qty || 0), 0)
    : summary.total_success ?? 0

  const unitPerfSum = summary.unit_performance_sum ?? summary.total_performance ?? 0
  const oeeDisplay = unitPerfSum != null ? `${(unitPerfSum * 100).toFixed(0)}%` : '-'

  if (!models || models.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow dark:shadow-slate-700/10 p-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100">{unit_name}</h2>
        <p className="text-gray-500 dark:text-gray-400 mt-4">Bu zaman aralığında veri bulunamadı.</p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow dark:shadow-slate-700/10 p-6">
      {/* Unit header */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100">{unit_name}</h2>
        <div className="flex items-center gap-2">
          <span key={`ok-${dataVersion}`} className={`text-lg font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-3 py-1 rounded-lg ${flashing ? 'animate-flash-update' : ''}`}>
            OK: {totalSuccess.toLocaleString()}
          </span>
          <span key={`oee-${dataVersion}`} className={`text-lg font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-3 py-1 rounded-lg ${flashing ? 'animate-flash-update' : ''}`}>
            OEE: {oeeDisplay}
          </span>
        </div>
      </div>

      {/* Model table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
          <thead className="bg-gray-50 dark:bg-slate-700/50">
            <tr>
              {['Model', 'Hedef', 'OK', 'Tamir', 'Kalite (%)', 'OEE (%)'].map((h) => (
                <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
            {models.map((model, idx) => {
              const modelName = model.model_name || model.model || '-'
              const successQty = model.success_qty ?? 0
              const failQty = model.fail_qty ?? 0
              const target = model.target || '-'
              const processed = successQty + failQty
              const quality = processed > 0 ? ((successQty / processed) * 100).toFixed(0) : '0'
              const performance =
                model.performance != null ? (model.performance * 100).toFixed(1) : '-'

              return (
                <tr
                  key={modelName + idx}
                  className={
                    idx % 2 === 0
                      ? 'bg-white dark:bg-slate-800/50'
                      : 'bg-gray-50 dark:bg-slate-700/30'
                  }
                >
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                    {modelName}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-blue-600 dark:text-blue-400">
                    {target}
                  </td>
                  <td key={`s-${dataVersion}`} className={`px-6 py-4 whitespace-nowrap text-sm text-green-600 dark:text-green-400 ${flashing ? 'animate-flash-update' : ''}`}>
                    {successQty.toLocaleString()}
                  </td>
                  <td key={`f-${dataVersion}`} className={`px-6 py-4 whitespace-nowrap text-sm text-red-600 dark:text-red-400 ${flashing ? 'animate-flash-update' : ''}`}>
                    {failQty.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {quality}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {performance}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default StandardView
