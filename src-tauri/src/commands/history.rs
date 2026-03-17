use crate::storage::DbState;
use rusqlite::params;
use std::fs;
use tauri::{command, AppHandle, Manager, State};
use uuid::Uuid;

#[derive(serde::Serialize)]
pub struct DocumentHistoryItem {
    id: i32,
    file_name: String,
    file_path: String,
    file_size: Option<String>,
    remote_code: Option<String>,
    source: Option<String>,
    file_hash: Option<String>,
    group_name: Option<String>,
    opened_at: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ChatHistoryItem {
    id: Option<i32>,
    text: String,
    sender: String,
    sender_name: Option<String>,
    timestamp: String,
    session_id: Option<String>,
}

#[command]
pub fn add_document_history(
    app: AppHandle,
    db_state: State<DbState>,
    file_name: String,
    file_path: String,
    file_size: Option<String>,
    remote_code: Option<String>,
    source: Option<String>,
    mut file_hash: Option<String>,
    group_name: Option<String>,
) -> Result<String, String> {
    let conn = db_state.0.lock().map_err(|e| e.to_string())?;

    // 1. Calcular Hash si no viene dado (evitar duplicados por contenido)
    if file_hash.is_none() {
        if let Ok(h) = crate::sha256::Sha256Service::hash_file(&file_path) {
            file_hash = Some(h);
        }
    }

    // 2. Verificar si el Hash ya existe en el historial
    if let Some(ref h) = file_hash {
        let existing_path: Option<String> = conn
            .query_row(
                "SELECT file_path FROM document_history WHERE file_hash = ?1",
                [h],
                |row| row.get(0),
            )
            .ok();

        if let Some(path) = existing_path {
            // Actualizar fecha de apertura si ya existe
            let _ = conn.execute(
                "UPDATE document_history SET opened_at = CURRENT_TIMESTAMP WHERE file_hash = ?1",
                [h],
            );
            return Ok(path); // Retornar ruta existente para no duplicar físico ni entrada
        }
    }

    let vault_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("sandra_vault");

    if !vault_dir.exists() {
        fs::create_dir_all(&vault_dir).unwrap_or_default();
    }

    let ext = std::path::Path::new(&file_name)
        .extension()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    let unique_id = Uuid::new_v4().to_string();
    let obfuscated_name = if ext.is_empty() {
        unique_id
    } else {
        format!("{}.{}", unique_id, ext)
    };

    let target_path = vault_dir.join(&obfuscated_name);

    let final_path = if !file_path.contains("sandra_vault") && fs::metadata(&file_path).is_ok() {
        if let Err(_e) = fs::copy(&file_path, &target_path) {
            file_path.clone()
        } else {
            target_path.to_string_lossy().to_string()
        }
    } else {
        file_path.clone()
    };

    conn.execute(
        "INSERT INTO document_history (file_name, file_path, file_size, remote_code, source, file_hash, group_name) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![file_name, final_path, file_size, remote_code, source.unwrap_or_else(|| "GLOBAL".to_string()), file_hash, group_name],
    )
    .map_err(|e| e.to_string())?;

    Ok(final_path)
}

#[command]
pub fn get_document_history(db_state: State<DbState>) -> Result<Vec<DocumentHistoryItem>, String> {
    let conn = db_state.0.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, file_name, file_path, opened_at, file_size, remote_code, source, file_hash, group_name FROM document_history ORDER BY opened_at DESC LIMIT 50")
        .map_err(|e| e.to_string())?;

    let history_iter = stmt
        .query_map([], |row| {
            Ok(DocumentHistoryItem {
                id: row.get(0)?,
                file_name: row.get(1)?,
                file_path: row.get(2)?,
                opened_at: row.get(3)?,
                file_size: row.get(4)?,
                remote_code: row.get(5)?,
                source: row.get(6)?,
                file_hash: row.get(7)?,
                group_name: row.get(8)?,
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

    // Intentar borrar archivo físico si está en el vault
    let path: Option<String> = conn
        .query_row(
            "SELECT file_path FROM document_history WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .ok();

    if let Some(p) = path {
        if p.contains("sandra_vault") {
            let _ = fs::remove_file(p);
        }
    }

    conn.execute("DELETE FROM document_history WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[command]
pub fn delete_document_group(db_state: State<DbState>, group_name: String) -> Result<(), String> {
    let conn = db_state.0.lock().map_err(|e| e.to_string())?;

    // Primero obtener las rutas para intentar borrar los archivos físicos si están en el vault
    let mut stmt = conn
        .prepare("SELECT file_path FROM document_history WHERE group_name = ?1")
        .map_err(|e| e.to_string())?;
    
    let paths_iter = stmt.query_map([&group_name], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;

    for path_res in paths_iter {
        if let Ok(path) = path_res {
             if path.contains("sandra_vault") {
                let _ = fs::remove_file(path);
             }
        }
    }

    conn.execute("DELETE FROM document_history WHERE group_name = ?1", params![group_name])
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[command]
pub fn save_chat_messages(
    db_state: State<DbState>,
    messages: Vec<ChatHistoryItem>,
) -> Result<(), String> {
    let mut conn = db_state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for msg in messages {
        tx.execute(
            "INSERT INTO chat_history (text, sender, sender_name, timestamp, session_id) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![msg.text, msg.sender, msg.sender_name, msg.timestamp, msg.session_id],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub fn get_chat_history(
    db_state: State<DbState>,
    limit: i32,
    offset: i32,
) -> Result<Vec<ChatHistoryItem>, String> {
    let conn = db_state.0.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, text, sender, sender_name, timestamp, session_id FROM chat_history ORDER BY timestamp DESC LIMIT ?1 OFFSET ?2")
        .map_err(|e| e.to_string())?;

    let history_iter = stmt
        .query_map(params![limit, offset], |row| {
            Ok(ChatHistoryItem {
                id: Some(row.get(0)?),
                text: row.get(1)?,
                sender: row.get(2)?,
                sender_name: row.get(3)?,
                timestamp: row.get(4)?,
                session_id: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut history = Vec::new();
    for item in history_iter {
        history.push(item.map_err(|e| e.to_string())?);
    }

    Ok(history)
}
