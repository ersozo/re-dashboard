from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
import json
import asyncio
import os
import time
import traceback
from typing import List, Dict

import database
from database import get_production_units, get_production_data, TIMEZONE, calculate_break_time


# ---------------------------------------------------------------------------
# App lifecycle: init / close the async DB connection pool
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    await database.init_pool()
    yield
    await database.close_pool()


app = FastAPI(lifespan=lifespan)

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------

origins = [
    "http://localhost",
    "http://localhost:8000",
    "http://localhost:5173",
    "http://127.0.0.1",
    "http://127.0.0.1:8000",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# ---------------------------------------------------------------------------
# Static file serving
# ---------------------------------------------------------------------------

FRONTEND_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "frontend-react", "dist")
)
VANILLA_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "frontend")
)

print(f"React Frontend directory: {FRONTEND_DIR}")

if os.path.exists(os.path.join(FRONTEND_DIR, "assets")):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIR, "assets")), name="assets")

if os.path.exists(VANILLA_DIR):
    app.mount("/legacy", StaticFiles(directory=VANILLA_DIR), name="legacy")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_normal_ws_close(error: Exception) -> bool:
    """Return True for expected WebSocket closure errors (not real bugs)."""
    msg = str(error).lower()
    return any(phrase in msg for phrase in (
        'keepalive ping timeout', 'heartbeat timeout', '1011',
        'connection closed', '1005', '1000', 'no status received',
    ))


def _parse_ws_params(params: dict):
    """Extract and timezone-convert start/end/working_mode from a WS message."""
    start_time_str = params['start_time'].replace('Z', '+00:00')
    end_time_str = params['end_time'].replace('Z', '+00:00')
    working_mode = params.get('working_mode', 'mode1')

    start_time = datetime.fromisoformat(start_time_str)
    end_time = datetime.fromisoformat(end_time_str)

    if start_time.tzinfo is not None:
        start_time = start_time.astimezone(TIMEZONE)
        end_time = end_time.astimezone(TIMEZONE)

    return start_time, end_time, working_mode


def _parse_time_params(start_time_raw: str, end_time_raw: str):
    """Parse ISO time strings from REST query params."""
    start_str = start_time_raw.replace('Z', '+00:00')
    end_str = end_time_raw.replace('Z', '+00:00')

    start_time = datetime.fromisoformat(start_str)
    end_time = datetime.fromisoformat(end_str)

    if start_time.tzinfo is not None:
        start_time = start_time.astimezone(TIMEZONE)
        end_time = end_time.astimezone(TIMEZONE)

    return start_time, end_time


# ---------------------------------------------------------------------------
# WebSocket connection manager
# ---------------------------------------------------------------------------

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {
            'standard': [],
            'hourly': [],
        }

    async def connect(self, websocket: WebSocket, connection_type: str = 'standard'):
        await websocket.accept()
        if connection_type not in self.active_connections:
            self.active_connections[connection_type] = []
        self.active_connections[connection_type].append(websocket)

    def disconnect(self, websocket: WebSocket, connection_type: str = 'standard'):
        if connection_type in self.active_connections:
            conns = self.active_connections[connection_type]
            if websocket in conns:
                conns.remove(websocket)

    async def broadcast(self, message: str, connection_type: str = 'standard'):
        if connection_type in self.active_connections:
            for connection in self.active_connections[connection_type]:
                await connection.send_text(message)


manager = ConnectionManager()


# ===================================================================
# REST ENDPOINTS  (async DB -- no more run_in_executor)
# ===================================================================

@app.get("/units")
async def get_units():
    return await get_production_units()


@app.get("/report-data")
async def get_report_data(units: str, start_time: str, end_time: str, working_mode: str = 'mode1'):
    """Aggregated report data for multiple units with weighted performance."""
    try:
        unit_list = [u.strip() for u in units.split(',') if u.strip()]
        if not unit_list:
            raise HTTPException(status_code=400, detail="No units specified")

        start_dt, end_dt = _parse_time_params(start_time, end_time)
        current_time = datetime.now(TIMEZONE)

        unit_data = {}
        total_success_all = 0
        total_fail_all = 0
        weighted_quality_sum = 0
        weighted_performance_sum = 0
        total_production_all = 0
        total_success_weight = 0

        for unit_name in unit_list:
            print(f"[REPORT] Starting async query for unit {unit_name}")
            try:
                production_data = await asyncio.wait_for(
                    get_production_data(unit_name, start_dt, end_dt, current_time, working_mode),
                    timeout=30.0,
                )
                print(f"[REPORT] Query completed for unit {unit_name}")
            except asyncio.TimeoutError:
                print(f"[REPORT ERROR] Timeout for unit {unit_name} - skipping")
                continue
            except Exception as db_error:
                print(f"[REPORT ERROR] DB error for unit {unit_name}: {db_error} - skipping")
                continue

            unit_success = sum(m['success_qty'] for m in production_data)
            unit_fail = sum(m['fail_qty'] for m in production_data)
            unit_total = unit_success + unit_fail
            unit_quality = unit_success / unit_total if unit_total > 0 else 0

            unit_performance_sum = sum(
                m['performance'] for m in production_data if m.get('performance') is not None
            )

            unit_data[unit_name] = {
                'total_success': unit_success,
                'total_fail': unit_fail,
                'total_qty': unit_total,
                'quality': unit_quality,
                'performance_sum': unit_performance_sum,
                'models': production_data,
            }

            total_success_all += unit_success
            total_fail_all += unit_fail
            total_production_all += unit_total

            if unit_total > 0:
                weighted_quality_sum += unit_quality * unit_total
            if unit_success > 0:
                weighted_performance_sum += unit_performance_sum * unit_success
                total_success_weight += unit_success

        overall_quality = weighted_quality_sum / total_production_all if total_production_all > 0 else 0
        overall_performance = weighted_performance_sum / total_success_weight if total_success_weight > 0 else 0

        return {
            'units': unit_data,
            'summary': {
                'total_success': total_success_all,
                'total_fail': total_fail_all,
                'total_production': total_production_all,
                'weighted_quality': overall_quality,
                'weighted_performance': overall_performance,
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in report data endpoint: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/historical-data/{unit_name}")
async def get_historical_data(unit_name: str, start_time: str, end_time: str, working_mode: str = 'mode1'):
    try:
        start_dt, end_dt = _parse_time_params(start_time, end_time)
        current_time = datetime.now(TIMEZONE)

        print(f"[HISTORICAL] Starting async query for unit {unit_name}")
        try:
            production_data = await asyncio.wait_for(
                get_production_data(unit_name, start_dt, end_dt, current_time, working_mode),
                timeout=30.0,
            )
            print(f"[HISTORICAL] Query completed for unit {unit_name}")
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="Database query timeout - try a smaller time range")
        except Exception as db_error:
            raise HTTPException(status_code=500, detail=f"Database error: {db_error}")

        total_success = sum(m['success_qty'] for m in production_data)
        total_fail = sum(m['fail_qty'] for m in production_data)
        total_qty = sum(m['total_qty'] for m in production_data)

        total_processed = total_success + total_fail
        total_quality = total_success / total_processed if total_processed > 0 else 0

        models_with_target = [m for m in production_data if m['target'] and m['target'] > 0]
        total_performance = None
        total_theoretical_qty = 0

        if models_with_target:
            operation_time_total = (end_dt - start_dt).total_seconds()
            break_time = calculate_break_time(start_dt, end_dt, working_mode)
            operation_time = max(operation_time_total - break_time, 0)

            total_actual_qty = sum(m['total_qty'] for m in models_with_target)
            if total_actual_qty > 0:
                weighted_target_rate = sum(
                    (m['total_qty'] / total_actual_qty) * m['target'] for m in models_with_target
                )
                total_theoretical_qty = (operation_time / 3600) * weighted_target_rate
                total_performance = total_actual_qty / total_theoretical_qty if total_theoretical_qty > 0 else 0

        unit_performance_sum = sum(
            m['performance'] for m in production_data if m.get('performance') is not None
        )

        return {
            'unit_name': unit_name,
            'total_success': total_success,
            'total_fail': total_fail,
            'total_qty': total_qty,
            'total_quality': total_quality,
            'total_performance': total_performance if total_performance is not None else 0,
            'unit_performance_sum': unit_performance_sum,
            'total_theoretical_qty': total_theoretical_qty,
            'models': production_data,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/historical-hourly-data/{unit_name}")
async def get_historical_hourly_data(unit_name: str, start_time: str, end_time: str, working_mode: str = 'mode1'):
    try:
        start_dt, end_dt = _parse_time_params(start_time, end_time)
        current_time = datetime.now(TIMEZONE)

        hourly_data = []
        current_hour = start_dt.replace(minute=0, second=0, microsecond=0)
        total_success = 0
        total_fail = 0
        total_qty = 0

        while current_hour < end_dt:
            hour_end = min(current_hour + timedelta(hours=1), end_dt)

            print(f"[HISTORICAL HOURLY] Async query for {unit_name}, hour {current_hour.strftime('%H:%M')}")
            try:
                hour_data = await asyncio.wait_for(
                    get_production_data(unit_name, current_hour, hour_end, current_time, working_mode),
                    timeout=30.0,
                )
            except asyncio.TimeoutError:
                print(f"[HISTORICAL HOURLY ERROR] Timeout for {unit_name} hour {current_hour.strftime('%H:%M')} - skipping")
                current_hour = hour_end
                continue
            except Exception as db_error:
                print(f"[HISTORICAL HOURLY ERROR] DB error for {unit_name} hour {current_hour.strftime('%H:%M')}: {db_error} - skipping")
                current_hour = hour_end
                continue

            hour_success = sum(m['success_qty'] for m in hour_data)
            hour_fail = sum(m['fail_qty'] for m in hour_data)
            hour_total = sum(m['total_qty'] for m in hour_data)

            total_success += hour_success
            total_fail += hour_fail
            total_qty += hour_total

            hour_quality = hour_success / (hour_success + hour_fail) if (hour_success + hour_fail) > 0 else 0

            models_with_target = [m for m in hour_data if m['target'] and m['target'] > 0]
            hour_performance = 0
            hour_theoretical_qty = 0

            if models_with_target:
                hour_op_time = (hour_end - current_hour).total_seconds()
                hour_break = calculate_break_time(current_hour, hour_end, working_mode)
                hour_op_time = max(hour_op_time - hour_break, 0)

                hour_actual_qty = sum(m['total_qty'] for m in models_with_target)
                if hour_actual_qty > 0:
                    weighted_rate = sum(
                        (m['total_qty'] / hour_actual_qty) * m['target'] for m in models_with_target
                    )
                    hour_theoretical_qty = (hour_op_time / 3600) * weighted_rate
                    hour_performance = hour_actual_qty / hour_theoretical_qty if hour_theoretical_qty > 0 else 0

            hourly_data.append({
                'hour_start': current_hour.isoformat(),
                'hour_end': hour_end.isoformat(),
                'success_qty': hour_success,
                'fail_qty': hour_fail,
                'total_qty': hour_total,
                'quality': hour_quality,
                'performance': hour_performance,
                'theoretical_qty': hour_theoretical_qty,
            })
            current_hour = hour_end

        total_quality = total_success / (total_success + total_fail) if (total_success + total_fail) > 0 else 0
        total_theoretical_qty = sum(h['theoretical_qty'] for h in hourly_data)
        total_performance = total_qty / total_theoretical_qty if total_theoretical_qty > 0 else 0

        return {
            'unit_name': unit_name,
            'total_success': total_success,
            'total_fail': total_fail,
            'total_qty': total_qty,
            'total_quality': total_quality,
            'total_performance': total_performance,
            'total_theoretical_qty': total_theoretical_qty,
            'hourly_data': hourly_data,
        }
    except Exception as e:
        print(f"Error in historical hourly data endpoint: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ===================================================================
# WEBSOCKET ENDPOINTS  (server-push pattern)
# ===================================================================

PUSH_INTERVAL = 12  # seconds between pushes


@app.websocket("/ws/{unit_name}")
async def websocket_endpoint(websocket: WebSocket, unit_name: str):
    """Standard dashboard -- server pushes fresh data every PUSH_INTERVAL seconds."""
    await manager.connect(websocket, 'standard')
    try:
        # 1. Wait for initial parameters from client (sent once on connect)
        raw = await websocket.receive_text()
        params = json.loads(raw)
        start_time, end_time, working_mode = _parse_ws_params(params)

        # 2. Server-driven push loop
        while True:
            current_time = datetime.now(TIMEZONE)

            # --- Query DB (truly async, no executor) ---
            try:
                production_data = await asyncio.wait_for(
                    get_production_data(unit_name, start_time, end_time, current_time, working_mode),
                    timeout=30.0,
                )
            except asyncio.TimeoutError:
                print(f"[STANDARD ERROR] DB timeout for {unit_name}")
                if websocket.client_state.name == 'CONNECTED':
                    await websocket.send_json({"error": "Database query timeout - try a smaller time range"})
                await asyncio.sleep(PUSH_INTERVAL)
                continue
            except Exception as db_error:
                print(f"[STANDARD ERROR] DB error for {unit_name}: {db_error}")
                if websocket.client_state.name == 'CONNECTED':
                    await websocket.send_json({"error": f"Database error: {db_error}"})
                await asyncio.sleep(PUSH_INTERVAL)
                continue

            # --- Build response (same business logic) ---
            for model in production_data:
                if not model['target']:
                    model['performance'] = None
                    model['oee'] = None

            total_success = sum(m['success_qty'] for m in production_data)
            total_fail = sum(m['fail_qty'] for m in production_data)
            total_qty = sum(m['total_qty'] for m in production_data)

            total_processed = total_success + total_fail
            total_quality = total_success / total_processed if total_processed > 0 else 0

            models_with_target = [m for m in production_data if m['target'] and m['target'] > 0]
            total_performance = 0

            if models_with_target:
                total_actual_qty = sum(m['total_qty'] for m in models_with_target)
                total_theoretical_qty = 0

                if total_actual_qty > 0:
                    weighted_target_rate = sum(
                        (m['total_qty'] / total_actual_qty) * m['target'] for m in models_with_target
                    )

                    actual_end = end_time
                    if current_time:
                        if (current_time - end_time) <= timedelta(minutes=5):
                            actual_end = current_time

                    op_total = max((actual_end - start_time).total_seconds(), 0)
                    brk = calculate_break_time(start_time, actual_end, working_mode)
                    op_time = max(op_total - brk, 0)
                    total_theoretical_qty = (op_time / 3600) * weighted_target_rate

                total_performance = total_actual_qty / total_theoretical_qty if total_theoretical_qty > 0 else 0

            unit_performance_sum = sum(
                m['performance'] for m in production_data if m.get('performance') is not None
            )

            response_data = {
                'unit_name': unit_name,
                'models': production_data,
                'summary': {
                    'total_success': total_success,
                    'total_fail': total_fail,
                    'total_qty': total_qty,
                    'total_quality': total_quality,
                    'total_performance': total_performance,
                    'unit_performance_sum': unit_performance_sum,
                },
            }

            # --- Push to client ---
            if websocket.client_state.name != 'CONNECTED':
                print(f"[STANDARD WARNING] Connection closed for {unit_name}")
                break

            await websocket.send_json(response_data)
            print(f"[STANDARD PUSH] Sent data to {unit_name}")

            # --- Wait for next cycle; also listen for param updates / heartbeats ---
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=PUSH_INTERVAL)
                new_params = json.loads(msg)
                if new_params.get('heartbeat'):
                    await websocket.send_json({"heartbeat": True, "timestamp": time.time()})
                else:
                    start_time, end_time, working_mode = _parse_ws_params(new_params)
                    print(f"[STANDARD] Params updated for {unit_name}")
            except asyncio.TimeoutError:
                pass  # No client message -- just push again

    except WebSocketDisconnect:
        print(f"[STANDARD INFO] WebSocket disconnected for {unit_name}")
    except Exception as e:
        if not _is_normal_ws_close(e):
            print(f"[STANDARD ERROR] Unexpected error for {unit_name}: {e}")
            traceback.print_exc()
    finally:
        manager.disconnect(websocket, 'standard')


@app.websocket("/ws/hourly/{unit_name}")
async def hourly_websocket_endpoint(websocket: WebSocket, unit_name: str):
    """Hourly dashboard -- server pushes fresh data every PUSH_INTERVAL seconds."""
    await manager.connect(websocket, 'hourly')
    try:
        # 1. Wait for initial parameters from client
        raw = await websocket.receive_text()
        params = json.loads(raw)
        start_time, end_time, working_mode = _parse_ws_params(params)

        # 2. Server-driven push loop
        while True:
            current_time = datetime.now(TIMEZONE)

            # --- Query DB for full range totals ---
            try:
                raw_data = await asyncio.wait_for(
                    get_production_data(unit_name, start_time, end_time, current_time, working_mode),
                    timeout=30.0,
                )
            except asyncio.TimeoutError:
                print(f"[HOURLY ERROR] DB timeout for {unit_name}")
                if websocket.client_state.name == 'CONNECTED':
                    await websocket.send_json({"error": "Database query timeout - try a smaller time range"})
                await asyncio.sleep(PUSH_INTERVAL)
                continue
            except Exception as db_error:
                print(f"[HOURLY ERROR] DB error for {unit_name}: {db_error}")
                if websocket.client_state.name == 'CONNECTED':
                    await websocket.send_json({"error": f"Database error: {db_error}"})
                await asyncio.sleep(PUSH_INTERVAL)
                continue

            # --- Totals from raw data ---
            total_success = sum(m['success_qty'] for m in raw_data)
            total_fail = sum(m['fail_qty'] for m in raw_data)
            total_qty = sum(m['total_qty'] for m in raw_data)

            total_processed = total_success + total_fail
            total_quality = total_success / total_processed if total_processed > 0 else 0

            models_with_target = [m for m in raw_data if m['target'] and m['target'] > 0]
            total_performance = None
            total_oee = None
            total_theoretical_qty = 0

            if models_with_target:
                actual_end = end_time
                if current_time:
                    if (current_time - end_time) <= timedelta(minutes=5):
                        actual_end = current_time

                op_total = max((actual_end - start_time).total_seconds(), 0)
                brk = calculate_break_time(start_time, actual_end, working_mode)
                op_time = max(op_total - brk, 0)

                total_actual_qty = sum(m['total_qty'] for m in models_with_target)
                if total_actual_qty > 0:
                    weighted_target_rate = sum(
                        (m['total_qty'] / total_actual_qty) * m['target'] for m in models_with_target
                    )
                    total_theoretical_qty = (op_time / 3600) * weighted_target_rate

                total_performance = total_actual_qty / total_theoretical_qty if total_theoretical_qty > 0 else 0
                total_oee = None

            # --- Hourly breakdown (query per hour) ---
            hourly_data = []
            current_hour = start_time.replace(minute=0, second=0, microsecond=0)

            is_live_data = False
            actual_end_for_hourly = end_time
            if current_time:
                abs_diff = abs((current_time - end_time).total_seconds())
                is_live_data = abs_diff <= 300  # 5 minutes
                if is_live_data:
                    actual_end_for_hourly = current_time

            while current_hour < actual_end_for_hourly:
                hour_end = current_hour + timedelta(hours=1)

                if is_live_data and current_hour < current_time < hour_end:
                    hour_end = current_time
                else:
                    hour_end = min(hour_end, actual_end_for_hourly)

                # Async query per hour
                try:
                    hour_data = await asyncio.wait_for(
                        get_production_data(unit_name, current_hour, hour_end, current_time, working_mode),
                        timeout=30.0,
                    )
                except (asyncio.TimeoutError, Exception):
                    if is_live_data and hour_end == current_time:
                        current_hour = current_hour + timedelta(hours=1)
                    else:
                        current_hour = hour_end
                    continue

                hour_success = sum(m['success_qty'] for m in hour_data)
                hour_fail = sum(m['fail_qty'] for m in hour_data)
                hour_total = sum(m['total_qty'] for m in hour_data)

                hour_quality = hour_success / (hour_success + hour_fail) if (hour_success + hour_fail) > 0 else 0

                hour_models_target = [m for m in hour_data if m['target'] and m['target'] > 0]
                hour_performance = 0
                hour_theoretical_qty = 0

                if hour_models_target:
                    h_op_time = (hour_end - current_hour).total_seconds()
                    h_brk = calculate_break_time(current_hour, hour_end, working_mode)
                    h_op_time = max(h_op_time - h_brk, 0)

                    h_actual = sum(m['total_qty'] for m in hour_models_target)
                    if h_actual > 0:
                        h_rate = sum(
                            (m['total_qty'] / h_actual) * m['target'] for m in hour_models_target
                        )
                        hour_theoretical_qty = (h_op_time / 3600) * h_rate
                        hour_performance = h_actual / hour_theoretical_qty if hour_theoretical_qty > 0 else 0

                hourly_data.append({
                    'hour_start': current_hour.isoformat(),
                    'hour_end': hour_end.isoformat(),
                    'success_qty': hour_success,
                    'fail_qty': hour_fail,
                    'total_qty': hour_total,
                    'quality': hour_quality,
                    'performance': hour_performance,
                    'oee': 0,
                    'theoretical_qty': hour_theoretical_qty,
                })

                if is_live_data and hour_end == current_time:
                    current_hour = current_hour + timedelta(hours=1)
                else:
                    current_hour = hour_end

            # --- Build response ---
            total_theoretical_qty = sum(h['theoretical_qty'] for h in hourly_data)

            response_data = {
                'unit_name': unit_name,
                'total_success': total_success,
                'total_fail': total_fail,
                'total_qty': total_qty,
                'total_quality': total_quality if total_quality is not None else 0,
                'total_performance': total_performance if total_performance is not None else 0,
                'total_oee': total_oee if total_oee is not None else 0,
                'total_theoretical_qty': total_theoretical_qty if total_theoretical_qty is not None else 0,
                'hourly_data': hourly_data,
            }

            for hd in response_data['hourly_data']:
                if hd['quality'] is None:
                    hd['quality'] = 0
                if hd['performance'] is None:
                    hd['performance'] = 0
                if hd['oee'] is None:
                    hd['oee'] = 0

            # --- Push to client ---
            if websocket.client_state.name != 'CONNECTED':
                print(f"[HOURLY WARNING] Connection closed for {unit_name}")
                break

            await websocket.send_json(response_data)
            print(f"[HOURLY PUSH] Sent data to {unit_name} with {len(hourly_data)} hours")

            # --- Wait for next cycle; also listen for param updates / heartbeats ---
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=PUSH_INTERVAL)
                new_params = json.loads(msg)
                if new_params.get('heartbeat'):
                    await websocket.send_json({"heartbeat": True, "timestamp": time.time()})
                else:
                    start_time, end_time, working_mode = _parse_ws_params(new_params)
                    print(f"[HOURLY] Params updated for {unit_name}")
            except asyncio.TimeoutError:
                pass

    except WebSocketDisconnect:
        print(f"[HOURLY INFO] WebSocket disconnected for {unit_name}")
    except Exception as e:
        if not _is_normal_ws_close(e):
            print(f"[HOURLY ERROR] Unexpected error for {unit_name}: {e}")
            traceback.print_exc()
    finally:
        manager.disconnect(websocket, 'hourly')


# ===================================================================
# SPA catch-all (must be defined AFTER all other routes)
# ===================================================================

@app.get("/{full_path:path}")
async def serve_react_app(full_path: str):
    file_path = os.path.join(FRONTEND_DIR, full_path)
    if full_path and os.path.exists(file_path) and os.path.isfile(file_path):
        return FileResponse(file_path)

    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)

    vanilla_index = os.path.join(VANILLA_DIR, "index.html")
    if os.path.exists(vanilla_index):
        return FileResponse(vanilla_index)

    return HTMLResponse(
        content="<h1>Dashboard Frontend Not Found</h1><p>Please build the React application.</p>",
        status_code=404,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
