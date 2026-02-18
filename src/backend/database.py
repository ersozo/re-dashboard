import os
import aioodbc
from dotenv import load_dotenv
from datetime import datetime, timedelta
import pytz

load_dotenv()

# Define timezone constant for application (GMT+3)
TIMEZONE = pytz.timezone('Europe/Istanbul')  # Turkey is in GMT+3

# Define shift breaks
SHIFT_BREAKS = {
    'a': {'start': '10:00', 'end': '10:15'},
    'b': {'start': '12:00', 'end': '12:30'},
    'c': {'start': '16:00', 'end': '16:15'},
    'd': {'start': '18:00', 'end': '18:30'},
    'e': {'start': '20:00', 'end': '20:30'},
    'f': {'start': '22:00', 'end': '22:15'},
    'g': {'start': '00:00', 'end': '00:30'},
    'h': {'start': '03:00', 'end': '03:15'},
    'i': {'start': '05:00', 'end': '05:30'}
}

# Define which breaks apply to each working mode
WORKING_MODE_BREAKS = {
    'mode1': ['a', 'b', 'e', 'f', 'h', 'i'],
    'mode2': ['a', 'b', 'c', 'f', 'g', 'h', 'i'],
    'mode3': ['a', 'b', 'c', 'd', 'f', 'g', 'h', 'i']
}

def calculate_break_time(start_time, end_time, working_mode='mode1'):
    """
    Calculate total break time that occurred between start_time and end_time
    based on the working mode. Pure computation -- no I/O.
    """
    if working_mode not in WORKING_MODE_BREAKS:
        working_mode = 'mode1'
    
    applicable_breaks = WORKING_MODE_BREAKS[working_mode]
    total_break_seconds = 0
    
    if start_time.tzinfo != TIMEZONE:
        start_time = start_time.astimezone(TIMEZONE)
    if end_time.tzinfo != TIMEZONE:
        end_time = end_time.astimezone(TIMEZONE)
    
    for break_id in applicable_breaks:
        break_info = SHIFT_BREAKS[break_id]
        
        break_start_time = datetime.strptime(break_info['start'], '%H:%M').time()
        break_end_time = datetime.strptime(break_info['end'], '%H:%M').time()
        
        current_date = start_time.date()
        end_date = end_time.date()
        
        while current_date <= end_date:
            break_start_dt = datetime.combine(current_date, break_start_time)
            break_end_dt = datetime.combine(current_date, break_end_time)
            
            if break_start_time > break_end_time:
                break_end_dt = break_end_dt + timedelta(days=1)
            
            break_start_dt = TIMEZONE.localize(break_start_dt)
            break_end_dt = TIMEZONE.localize(break_end_dt)
            
            overlap_start = max(start_time, break_start_dt)
            overlap_end = min(end_time, break_end_dt)
            
            if overlap_start < overlap_end:
                overlap_seconds = (overlap_end - overlap_start).total_seconds()
                total_break_seconds += overlap_seconds
            
            current_date += timedelta(days=1)
    
    return total_break_seconds


# ---------------------------------------------------------------------------
# Async connection pool
# ---------------------------------------------------------------------------

_pool = None

def _build_dsn():
    return (
        f'DRIVER={{ODBC Driver 18 for SQL Server}};'
        f'SERVER={os.getenv("DB_SERVER")};'
        f'DATABASE={os.getenv("DB_NAME")};'
        f'UID={os.getenv("DB_USER")};'
        f'PWD={os.getenv("DB_PASSWORD")};'
        'Trusted_Connection=no;'
        'TrustServerCertificate=yes;'
        'Encrypt=yes;'
    )


async def init_pool():
    """Create the async connection pool. Call once at app startup."""
    global _pool
    dsn = _build_dsn()
    print(f"[DB] Initializing async connection pool...")
    print(f"[DB] Server: {os.getenv('DB_SERVER')}, Database: {os.getenv('DB_NAME')}")
    _pool = await aioodbc.create_pool(dsn=dsn, minsize=2, maxsize=10)
    print(f"[DB] Connection pool ready (min=2, max=10)")


async def close_pool():
    """Close the connection pool. Call once at app shutdown."""
    global _pool
    if _pool:
        _pool.close()
        await _pool.wait_closed()
        _pool = None
        print("[DB] Connection pool closed")


async def get_production_units():
    async with _pool.acquire() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute(
                "SELECT DISTINCT UnitName FROM ProductRecordLogView ORDER BY UnitName"
            )
            rows = await cursor.fetchall()
            return [row[0] for row in rows]


async def get_production_data(unit_name, start_time, end_time, current_time=None, working_mode='mode1'):
    actual_end_time = current_time if current_time else end_time
    
    # Ensure all datetimes use the same timezone (GMT+3)
    if start_time.tzinfo is None:
        start_time = TIMEZONE.localize(start_time)
    elif start_time.tzinfo != TIMEZONE:
        start_time = start_time.astimezone(TIMEZONE)
        
    if actual_end_time.tzinfo is None:
        actual_end_time = TIMEZONE.localize(actual_end_time)
    elif actual_end_time.tzinfo != TIMEZONE:
        actual_end_time = actual_end_time.astimezone(TIMEZONE)
    
    if actual_end_time < start_time:
        actual_end_time = start_time
    
    query_end_time = end_time
    if query_end_time.tzinfo is None:
        query_end_time = TIMEZONE.localize(query_end_time)
    elif query_end_time.tzinfo != TIMEZONE:
        query_end_time = query_end_time.astimezone(TIMEZONE)
    
    # Detect historical vs live data
    final_query_end_time = query_end_time
    
    if current_time:
        time_difference = current_time - query_end_time
        five_minutes = timedelta(minutes=5)
        
        if time_difference <= five_minutes:
            final_query_end_time = actual_end_time
        else:
            final_query_end_time = query_end_time
            actual_end_time = query_end_time
    
    table_name = "ProductRecordLogView"
    
    query = f"""
    SELECT 
        Model,
        SUM(CASE WHEN TestSonucu = 1 THEN 1 ELSE 0 END) as SuccessQty,
        SUM(CASE WHEN TestSonucu = 0 THEN 1 ELSE 0 END) as FailQty,
        ModelSuresiSN as Target
    FROM 
        {table_name}
    WHERE 
        UnitName = ? 
        AND KayitTarihi BETWEEN ? AND ?
    GROUP BY 
        Model, ModelSuresiSN
    """
    
    async with _pool.acquire() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute(query, (unit_name, start_time, final_query_end_time))
            all_rows = await cursor.fetchall()
    
    # --- Business logic (pure computation, unchanged) ---
    
    operation_time_total = (actual_end_time - start_time).total_seconds()
    break_time = calculate_break_time(start_time, actual_end_time, working_mode)
    operation_time = max(operation_time_total - break_time, 0)
    operation_time_hours = operation_time / 3600
    
    results = []
    models_with_target = []
    
    for row in all_rows:
        model_data = {
            'model': row[0],
            'success_qty': row[1],
            'fail_qty': row[2],
            'target': row[3],
            'total_qty': row[1],
            'quality': row[1] / (row[1] + row[2]) if (row[1] + row[2]) > 0 else 0,
            'performance': None,
            'oee': None
        }
        
        if row[3] is not None and row[3] > 0:
            individual_theoretical_qty = operation_time_hours * row[3]
            model_data['theoretical_qty'] = individual_theoretical_qty
            models_with_target.append(model_data)
        else:
            model_data['theoretical_qty'] = 0
            
        results.append(model_data)
    
    if models_with_target:
        for model_data in results:
            if model_data['target'] is not None and model_data['target'] > 0:
                individual_theoretical_qty = operation_time_hours * model_data['target']
                model_data['theoretical_qty'] = individual_theoretical_qty
                
                if individual_theoretical_qty > 0:
                    model_data['performance'] = model_data['total_qty'] / individual_theoretical_qty
                else:
                    model_data['performance'] = 0
            else:
                model_data['theoretical_qty'] = 0
                model_data['performance'] = None
    else:
        for model_data in results:
            if model_data['target'] is not None and model_data['target'] > 0:
                model_data['performance'] = 0
    
    return results
