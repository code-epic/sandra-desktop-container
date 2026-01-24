use crate::storage::DbState;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Deserialize)]
pub struct AppLog {
    pub id: Option<i32>,
    pub app_id: String,
    pub log_type: String,
    pub message: String,
    pub details: Option<Value>,
    pub source: Option<String>,
    pub timestamp: Option<String>,
}

#[derive(Serialize)]
pub struct DbStats {
    pub connected: bool,
    pub table_count: usize,
    pub tables: Vec<String>,
    pub size_bytes: i64,
}

#[derive(Serialize)]
pub struct ColumnInfo {
    pub name: String,
    pub type_: String,
}

#[tauri::command]
pub async fn get_table_columns(
    state: tauri::State<'_, DbState>,
    table_name: String,
) -> Result<Vec<ColumnInfo>, String> {
    // ... (get_table_columns implementation remains) ...
    let conn = state.0.lock().unwrap();
    let query = format!("PRAGMA table_info('{}')", table_name.replace("'", "''"));
    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ColumnInfo {
                name: row.get::<_, String>(1)?,
                type_: row.get::<_, String>(2)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut columns = Vec::new();
    for r in rows {
        columns.push(r.unwrap());
    }
    Ok(columns)
}

#[tauri::command]
pub async fn save_app_log(state: tauri::State<'_, DbState>, log: AppLog) -> Result<(), String> {
    let conn = state.0.lock().unwrap();

    // Serializar details a String si existe
    let details_str = match &log.details {
        Some(v) => Some(v.to_string()),
        None => None,
    };

    conn.execute(
        "INSERT INTO app_logs (app_id, log_type, message, details, source) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![&log.app_id, &log.log_type, &log.message, details_str, &log.source],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_app_logs(
    state: tauri::State<'_, DbState>,
    app_id: String,
) -> Result<Vec<AppLog>, String> {
    let conn = state.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, app_id, log_type, message, details, source, timestamp 
         FROM app_logs WHERE app_id = ?1 
         ORDER BY id DESC LIMIT 100",
        )
        .map_err(|e| e.to_string())?;

    let log_iter = stmt
        .query_map([&app_id], |row: &rusqlite::Row| {
            // Deserializar details de String a Value
            let details_str: Option<String> = row.get(4)?;
            let details_val: Option<Value> = match details_str {
                Some(s) => serde_json::from_str(&s).ok(),
                None => None,
            };

            Ok(AppLog {
                id: Some(row.get(0)?),
                app_id: row.get(1)?,
                log_type: row.get(2)?,
                message: row.get(3)?,
                details: details_val,
                source: row.get(5).unwrap_or(None),
                timestamp: Some(row.get(6)?),
            })
        })
        .map_err(|e| e.to_string())?;

    let mut logs = Vec::new();
    for log in log_iter {
        logs.push(log.unwrap());
    }
    Ok(logs)
}

// #[tauri::command]
// pub async fn clear_app_logs(
//     state: tauri::State<'_, DbState>,
//     app_id: String,
// ) -> Result<(), String> {
//     let conn = state.0.lock().unwrap();

//     conn.execute("DELETE FROM app_logs WHERE app_id = ?1", [&app_id])
//         .map_err(|e| e.to_string())?;

//     Ok(())
// }

#[tauri::command]
pub async fn get_db_stats(state: tauri::State<'_, DbState>) -> Result<DbStats, String> {
    let conn = state.0.lock().unwrap();
    // Consultamos las tablas del sistema excluyendo las internas de sqlite
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let mut tables = Vec::new();
    for r in rows {
        tables.push(r.unwrap());
    }

    let page_count: i64 = conn
        .query_row("PRAGMA page_count", [], |row| row.get(0))
        .unwrap_or(0);
    let page_size: i64 = conn
        .query_row("PRAGMA page_size", [], |row| row.get(0))
        .unwrap_or(0);
    let total_size = page_count * page_size;

    Ok(DbStats {
        connected: true,
        table_count: tables.len(),
        tables,
        size_bytes: total_size,
    })
}

#[tauri::command]
pub fn clear_app_logs(
    state: tauri::State<'_, DbState>,
    app_id: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    if let Some(id) = app_id {
        // Borrado parcial (solo una app)
        conn.execute("DELETE FROM app_logs WHERE app_id = ?", [id])
            .map_err(|e| e.to_string())?;
    } else {
        // Borrado total -> Recrear tabla (DROP & CREATE)
        crate::storage::recreate_app_logs_table(&conn)?;
    }
    Ok(())
}
