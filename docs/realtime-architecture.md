# Real-Time Update Architecture

## Overview

The production dashboard uses a **server-push** architecture to deliver live data updates to the frontend with minimal latency and zero unnecessary network traffic.

```
SQL Server DB ──► FastAPI Backend ──► WebSocket ──► React Frontend
                  (server-push)       (per unit)     (auto re-render)
```

---

## 1. Backend: Server-Push via WebSocket

When a user opens a live view, the React app opens **one WebSocket connection per selected production unit** (e.g., `ws://host/ws/Final 1A`).

The backend's WebSocket handler (`main.py`) runs an **infinite loop** that:

1. Queries the database every few seconds using `aioodbc` (async, non-blocking)
2. Compares the fresh data against the last sent data
3. If anything changed, **pushes the new data** to the client automatically

### Server-Push vs Client-Pull

| Aspect              | Old (Client-Pull)                  | New (Server-Push)                    |
|---------------------|------------------------------------|--------------------------------------|
| Who initiates?      | Client asks on a timer             | Server sends when data changes       |
| Wasted requests     | Many (when nothing changed)        | None                                 |
| Update latency      | Up to polling interval             | Near-instant                         |
| Network traffic     | Higher (constant polling)          | Lower (only meaningful updates)      |

### Connection Health

- A **heartbeat** is sent every 30 seconds to keep the connection alive
- If a connection drops, the client uses **exponential backoff** to reconnect (1s, 2s, 4s, ... up to 30s, max 20 attempts)

---

## 2. Frontend: React State-Driven Re-Rendering

When a WebSocket message arrives in the `useDashboardData` hook:

1. The hook collects data from all unit sockets into a single array
2. Once all units have reported, it calls `setData([...allData])` which triggers a React re-render
3. React's virtual DOM diffing automatically updates **only the DOM elements whose values actually changed**
4. A `dataVersion` counter increments, triggering CSS flash animations on updated elements
5. The "Güncelleniyor..." indicator appears briefly (500ms) to give visual feedback

### State Management Flow

```
WebSocket message arrives
  ├── unitDataMap[unit] = newData
  ├── All units reported?
  │     ├── YES → setUpdating(true)      ─┐
  │     │         setData([...allData])    │ Batched into
  │     │         setLastUpdate(now)       │ a single React
  │     │         setDataVersion(v + 1)   ─┘ render cycle
  │     │
  │     │         setTimeout(500ms) → setUpdating(false)  ← separate render
  │     │
  │     └── NO  → wait for remaining units
  └── heartbeat/error → ignore
```

---

## 3. Why It's Efficient

### Backend

- **`aioodbc`** — Async database driver means the backend can handle many WebSocket connections concurrently without blocking threads
- **Connection pooling** — Database connections are reused from a pool, not created per request
- **`asyncio`** — FastAPI's event loop handles all I/O concurrently; one process can serve many clients

### Frontend

- **React batching** — Multiple state updates (`setData`, `setUpdating`, `setDataVersion`) are merged into a single DOM update by React 18+
- **Virtual DOM diffing** — Only the specific cells/elements that changed are updated in the real DOM
- **CSS animations** — Flash effects run on the browser's GPU compositor thread with zero main-thread cost
- **No polling** — The frontend doesn't repeatedly ask "is there new data?"; the server tells it when there is

### Network

- **WebSocket** — Persistent bidirectional connection; no HTTP overhead per message (no headers, no handshake)
- **Delta detection** — Server only sends data when values have actually changed
- **Per-unit channels** — Each unit has its own WebSocket, so updates are scoped and lightweight

---

## 4. Data Flow by View Type

### Standard View (Model Dağılımı)

```
/ws/{unit_name} → per-unit model breakdown (models[], summary)
```

### Report View (Üretim Raporu)

```
/ws/{unit_name} → per-unit data aggregated into charts with drill-down
```

### Hourly Signage (Ekrana Yansıt)

```
/ws/hourly/{unit_name} → per-unit hourly breakdown (hourly_data[], totals)
```

---

## 5. Historical vs Live Mode

| Mode       | Data Source      | Updates          | Indicator        |
|------------|------------------|------------------|------------------|
| **Live**   | WebSocket push   | Continuous       | Green "Canlı" + "Güncelleniyor..." flash |
| **Historical** | REST API fetch | One-time load | Gray "Geçmiş" + date range display |

Historical views use standard HTTP `fetch()` calls to REST endpoints (`/historical-data/`, `/historical-hourly-data/`, `/report-data`) and do not open WebSocket connections.
