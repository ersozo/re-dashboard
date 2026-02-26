import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useLocation } from 'react-router-dom'

const HEARTBEAT_INTERVAL = 30_000 // 30 seconds
const RECONNECT_BASE_DELAY = 1_000 // 1 second
const RECONNECT_MAX_DELAY = 30_000 // 30 seconds
const MAX_RECONNECT_ATTEMPTS = 20

const useDashboardData = (viewType) => {
  const location = useLocation()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [updating, setUpdating] = useState(false)
  const [dataVersion, setDataVersion] = useState(0)
  const socketsRef = useRef({})
  const heartbeatTimersRef = useRef({})
  const reconnectAttemptsRef = useRef({})
  const cleanedUpRef = useRef(false)
  const updatingTimerRef = useRef(null)

  // Stabilize query params so they don't change reference every render
  const queryParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search]
  )

  const units = useMemo(
    () => queryParams.getAll('units'),
    [queryParams]
  )

  // Serialize units to a string for stable dependency tracking
  const unitsKey = useMemo(() => units.join('|'), [units])

  const startTime = queryParams.get('start')
  const endTime = queryParams.get('end')
  const workingMode = queryParams.get('workingMode') || 'mode1'
  const isLive = queryParams.get('isLive') === 'true'

  const fetchDataHistorical = useCallback(async () => {
    setLoading(true)
    try {
      if (viewType === 'report') {
        const response = await fetch(
          `/report-data?units=${encodeURIComponent(units.join(','))}&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}&working_mode=${encodeURIComponent(workingMode)}&is_live=${isLive}`
        )
        const result = await response.json()
        setData(result)
      } else if (viewType === 'hourly') {
        const results = await Promise.all(
          units.map(async (unit) => {
            const res = await fetch(
              `/historical-hourly-data/${encodeURIComponent(unit)}?start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}&working_mode=${encodeURIComponent(workingMode)}`
            )
            return await res.json()
          })
        )
        setData(results)
      } else {
        const results = await Promise.all(
          units.map(async (unit) => {
            const res = await fetch(
              `/historical-data/${encodeURIComponent(unit)}?start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}&working_mode=${encodeURIComponent(workingMode)}`
            )
            return await res.json()
          })
        )
        setData(results)
      }
      setLastUpdate(new Date())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitsKey, startTime, endTime, workingMode, viewType])

  const cleanupUnit = useCallback((unit) => {
    if (heartbeatTimersRef.current[unit]) {
      clearInterval(heartbeatTimersRef.current[unit])
      delete heartbeatTimersRef.current[unit]
    }
    if (socketsRef.current[unit]) {
      socketsRef.current[unit].close()
      delete socketsRef.current[unit]
    }
  }, [])

  const connectUnit = useCallback((unit, unitDataMap) => {
    if (cleanedUpRef.current) return

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = viewType === 'hourly'
      ? `${wsProtocol}//${window.location.host}/ws/hourly/${encodeURIComponent(unit)}`
      : `${wsProtocol}//${window.location.host}/ws/${encodeURIComponent(unit)}`

    const socket = new WebSocket(wsUrl)

    socket.onopen = () => {
      console.log(`[WS] Connected to ${unit}`)
      reconnectAttemptsRef.current[unit] = 0
      setError(null)
      setUpdating(true)

      socket.send(JSON.stringify({
        start_time: startTime,
        end_time: endTime,
        working_mode: workingMode,
      }))

      // Start heartbeat timer
      if (heartbeatTimersRef.current[unit]) {
        clearInterval(heartbeatTimersRef.current[unit])
      }
      heartbeatTimersRef.current[unit] = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ heartbeat: true }))
        }
      }, HEARTBEAT_INTERVAL)
    }

    socket.onmessage = (event) => {
      const update = JSON.parse(event.data)

      // Ignore heartbeat responses and error messages
      if (update.heartbeat) return
      if (update.error) {
        console.warn(`[WS] Server error for ${unit}:`, update.error)
        return
      }

      unitDataMap[unit] = update

      const allData = units.map(u => unitDataMap[u]).filter(Boolean)
      if (allData.length === units.length) {
        // Apply data immediately — React batches all these into one render
        if (updatingTimerRef.current) clearTimeout(updatingTimerRef.current)
        setUpdating(true)
        setData([...allData])
        setLoading(false)
        setLastUpdate(new Date())
        setDataVersion(v => v + 1)

        // Clear "Güncelleniyor..." after 500ms (runs in a separate render cycle)
        updatingTimerRef.current = setTimeout(() => setUpdating(false), 500)
      }
    }

    socket.onerror = (err) => {
      console.error(`[WS] Error for ${unit}:`, err)
    }

    socket.onclose = (event) => {
      console.log(`[WS] Closed for ${unit} (code: ${event.code})`)

      // Clear heartbeat
      if (heartbeatTimersRef.current[unit]) {
        clearInterval(heartbeatTimersRef.current[unit])
        delete heartbeatTimersRef.current[unit]
      }

      // Don't reconnect if we're cleaning up
      if (cleanedUpRef.current) return

      // Auto-reconnect with exponential backoff
      const attempts = reconnectAttemptsRef.current[unit] || 0
      if (attempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(
          RECONNECT_BASE_DELAY * Math.pow(2, attempts),
          RECONNECT_MAX_DELAY
        )
        reconnectAttemptsRef.current[unit] = attempts + 1
        console.log(`[WS] Reconnecting ${unit} in ${delay}ms (attempt ${attempts + 1})`)
        setTimeout(() => {
          if (!cleanedUpRef.current) {
            delete socketsRef.current[unit]
            connectUnit(unit, unitDataMap)
          }
        }, delay)
      } else {
        setError(`Connection lost for ${unit} after ${MAX_RECONNECT_ATTEMPTS} attempts`)
      }
    }

    socketsRef.current[unit] = socket
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewType, startTime, endTime, workingMode, unitsKey])

  useEffect(() => {
    if (!isLive) {
      fetchDataHistorical()
      return
    }

    // Live Data - WebSocket Logic (server-push)
    cleanedUpRef.current = false
    setLoading(true)
    const activeUnitsSet = new Set(units)

    // Cleanup sockets for units no longer selected
    Object.keys(socketsRef.current).forEach(unit => {
      if (!activeUnitsSet.has(unit)) {
        cleanupUnit(unit)
      }
    })

    const unitDataMap = {}

    units.forEach(unit => {
      if (socketsRef.current[unit]) return
      reconnectAttemptsRef.current[unit] = 0
      connectUnit(unit, unitDataMap)
    })

    return () => {
      cleanedUpRef.current = true
      Object.keys(socketsRef.current).forEach(cleanupUnit)
      socketsRef.current = {}
      heartbeatTimersRef.current = {}
      reconnectAttemptsRef.current = {}
      if (updatingTimerRef.current) clearTimeout(updatingTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, unitsKey, startTime, endTime, workingMode, viewType, fetchDataHistorical, connectUnit, cleanupUnit])

  return { data, loading, error, lastUpdate, isLive, units, startTime, endTime, updating, dataVersion }
}

export default useDashboardData
