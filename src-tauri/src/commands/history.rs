use crate::storage::DbState;
use rusqlite::params;
use tauri::{command, State};

#[derive(serde::Serialize)]
pub struct DocumentHistoryItem {
    id: i32,
    file_name: String,
    file_path: String,
    opened_at: String,
}

#[command]
pub fn add_document_history(
    db_state: State<DbState>,
    file_name: String,
    file_path: String,
) -> Result<(), String> {
    let conn = db_state.0.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO document_history (file_name, file_path) VALUES (?1, ?2)",
        params![file_name, file_path],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[command]
pub fn get_document_history(db_state: State<DbState>) -> Result<Vec<DocumentHistoryItem>, String> {
    let conn = db_state.0.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, file_name, file_path, opened_at FROM document_history ORDER BY opened_at DESC LIMIT 20")
        .map_err(|e| e.to_string())?;

    let history_iter = stmt
        .query_map([], |row| {
            Ok(DocumentHistoryItem {
                id: row.get(0)?,
                file_name: row.get(1)?,
                file_path: row.get(2)?,
                opened_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut history = Vec::new();
    for item in history_iter {
        history.push(item.map_err(|e| e.to_string())?);
    }

    Ok(history)
}

#[command]
pub fn delete_document_history(db_state: State<DbState>, id: i32) -> Result<(), String> {
    let conn = db_state.0.lock().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM document_history WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    Ok(())
}
