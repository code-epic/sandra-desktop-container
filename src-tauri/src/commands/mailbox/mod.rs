pub mod types;
pub mod repository;
pub mod sync_service;

use crate::storage::DbState;
use tauri::State;
use std::fs;
use std::io::Write;
use crate::crypto;

pub use self::types::*;
pub use self::repository::MailboxRepository;
pub use self::sync_service::SyncService;

// --- Commands: Mailbox ---

#[tauri::command]
pub fn get_mailbox_messages(state: State<DbState>, user_login: String) -> Result<Vec<MailboxMessage>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let repo = MailboxRepository::new(&conn);
    repo.get_all_messages(&user_login).map_err(|e: rusqlite::Error| e.to_string())
}

#[tauri::command]
pub async fn sync_mailbox(
    state: State<'_, DbState>,
    app_handle: tauri::AppHandle,
) -> Result<Vec<String>, String> {
    SyncService::sync(state, app_handle).await
}

#[tauri::command]
pub fn ingest_secure_package(
    state: State<DbState>,
    file_path: String,
    user_login: String,
) -> Result<IngestReport, String> {
    let encrypted_data = fs::read(&file_path).map_err(|e| format!("Error reading file: {}", e))?;

    // 1. Intentar con Device Secret (Nuevo estándar)
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let repo = MailboxRepository::new(&conn);
    let device_secret = repo.get_or_create_device_secret().map_err(|e| e.to_string())?;
    let key_bytes = crypto::derive_32byte_key(&device_secret)?;
    
    let mut plaintext = crypto::decrypt_raw(&encrypted_data, &key_bytes).ok();

    // 2. Fallback a MAC (Legacy / Externo)
    if plaintext.is_none() {
        let stats = crate::commands::monitor::collect_system_stats();
        let mac = stats.mac_address;
        if mac != "No MAC Found" && mac != "Unknown MAC" {
            let legacy_key_bytes = crypto::derive_32byte_key(&mac)?;
            plaintext = crypto::decrypt_raw(&encrypted_data, &legacy_key_bytes).ok();
        }
    }

    let final_plaintext = plaintext.ok_or("Decryption failed. No valid key found (Secret or MAC).")?;

    let messages: Vec<MailboxMessage> =
        serde_json::from_slice(&final_plaintext).map_err(|e| format!("Invalid JSON payload: {}", e))?;

    let mut imported = 0;
    let mut skipped = 0;

    for msg in messages {
        let sid = msg.sid.clone().unwrap_or_default();
        if repo.message_exists(&sid, &user_login).unwrap_or(false) {
            skipped += 1;
            continue;
        }

        let tracking_info = serde_json::to_string(&msg.attachments).unwrap_or("[]".to_string());
        repo.insert_message(
            Some(sid),
            msg.content,
            msg.author,
            "Pending",
            "inbox",
            msg.responsible,
            Some(tracking_info),
            Some(user_login.clone())
        ).map_err(|e: rusqlite::Error| e.to_string())?;
        imported += 1;
    }

    Ok(IngestReport {
        total: imported + skipped,
        imported,
        skipped,
        errors: vec![],
    })
}

#[tauri::command]
pub fn generate_secure_package(
    messages: Vec<MailboxMessage>,
    target_mac: String,
    output_path: String,
) -> Result<String, String> {
    let plaintext = serde_json::to_vec(&messages).map_err(|e| e.to_string())?;
    let key_bytes = crypto::derive_32byte_key(&target_mac)?;
    let package = crypto::encrypt_raw(&plaintext, &key_bytes)?;

    let mut file = fs::File::create(&output_path).map_err(|e| e.to_string())?;
    file.write_all(&package).map_err(|e| e.to_string())?;

    Ok(format!("Package created at {}", output_path))
}

#[tauri::command]
pub fn create_mailbox_message(
    state: State<DbState>,
    sid: Option<String>,
    content: Option<String>,
    author: Option<String>,
    responsible: Option<String>,
    direction: Option<String>,
    user_login: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let repo = MailboxRepository::new(&conn);
    let unwrapped_dir = direction.unwrap_or_else(|| "outbox".to_string());

    repo.insert_message(
        sid,
        content,
        author,
        "Pending",
        &unwrapped_dir,
        responsible,
        None,
        user_login
    ).map_err(|e: rusqlite::Error| e.to_string())
}

#[tauri::command]
pub fn update_mailbox_status(
    state: State<DbState>,
    id: i64,
    status: String,
    tracking_info: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let repo = MailboxRepository::new(&conn);
    repo.update_status(id, &status, tracking_info).map_err(|e: rusqlite::Error| e.to_string())
}

#[tauri::command]
pub fn delete_mailbox_message(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let repo = MailboxRepository::new(&conn);
    repo.delete_message(id).map_err(|e: rusqlite::Error| e.to_string())
}
