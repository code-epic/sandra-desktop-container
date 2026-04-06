pub mod repository;
pub mod sync_service;
pub mod types;

use crate::crypto;
use crate::storage::DbState;
use futures_util::StreamExt;
use reqwest::Client;
use std::fs;
use std::io::Write;
use tauri::{AppHandle, Emitter, Manager, State};

pub use self::repository::MailboxRepository;
pub use self::sync_service::SyncService;
pub use self::types::*;

// --- Commands: Mailbox ---

#[tauri::command]
pub async fn mailbox_download_attachment(
    app_handle: AppHandle,
    state: State<'_, DbState>,
    ip: String,
    port: u16,
    hash: String,
    temp_auth_token: Option<String>,
    _message_guid: String,
    remote_code: String,
    file_name: String,
    user_login: String,
) -> Result<String, String> {
    let _task_id = format!("dl_att_{}", remote_code);
    let hash_id = format!(
        "SDC-AUTO-{}",
        if _message_guid.len() >= 8 {
            &_message_guid[0..8]
        } else {
            &_message_guid
        }
    );

    let url = format!(
        "https://{}:{}/v1/api/dw/{}/{}",
        ip, port, hash_id, remote_code
    );
    println!("Downloading attachment from: {}", url);
    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("Client builder error: {}", e))?;

    // Usar la lógica de headers de api.rs (get_auth_headers es privado, así que replicamos lo esencial)
    let secret = if hash.len() >= 32 {
        &hash[0..32]
    } else {
        &hash
    };

    // Auth Headers
    let stats = crate::commands::monitor::collect_system_stats();
    let context_val = serde_json::json!({
        "os_info": stats.os_info,
        "mac_address": stats.mac_address,
        "network": stats.local_ip
    });
    let context_str = serde_json::to_string(&context_val).unwrap_or_default();
    use base64::{engine::general_purpose, Engine as _};
    let encoded_b64 = general_purpose::STANDARD.encode(context_str);
    let encoded_device_context = crate::sha256::Sha256Service::encrypt_device_context(
        &serde_json::Value::String(encoded_b64),
        secret,
    )
    .map_err(|e| format!("Crypto error: {}", e))?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis()
        .to_string();

    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("X-Device-Context", encoded_device_context.parse().unwrap());
    headers.insert("X-Timestamp", timestamp.parse().unwrap());
    headers.insert("Web-API-key", secret.parse().unwrap());
    if let Some(token) = temp_auth_token {
        headers.insert(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {}", token).parse().unwrap(),
        );
    }

    let res = client
        .get(&url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("HTTP Error: {}", res.status()));
    }

    let total_size = res.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut buffer = Vec::new();
    let mut stream = res.bytes_stream();

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| format!("Stream error: {}", e))?;
        buffer.extend_from_slice(&chunk);
        downloaded += chunk.len() as u64;

        if total_size > 0 {
            let progress = (downloaded as f32 / total_size as f32 * 100.0) as u32;
            let _ = app_handle.emit(
                "mailbox-download-progress",
                serde_json::json!({
                    "remote_code": remote_code,
                    "progress": progress,
                    "status": "downloading"
                }),
            );
        }
    }

    // --- Validación de Contenido (Sandra Backend Error Handling) ---
    // Si el servidor Go no encuentra el archivo pero responde 200 con un string de error.
    if buffer.starts_with(b"El documento fall\xc3\xb3") {
        return Err("El documento no se encuentra disponible en el servidor.".to_string());
    }

    // --- Soporte Zstd (.zst) ---
    let mut file_name = file_name;
    let mut buffer = buffer;
    if file_name.to_lowercase().ends_with(".zst") {
        buffer = zstd::decode_all(&buffer[..])
            .map_err(|e| format!("Error descomprimiendo adjunto (zstd): {}", e))?;
        // Remover extensión .zst para el registro local
        file_name = file_name[..file_name.len() - 4].to_string();
    }

    // 2. Preparar Directorio Vault
    let mut vault_path = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("AppDataDir error: {}", e))?;
    vault_path.push("sandra_vault");
    if !vault_path.exists() {
        fs::create_dir_all(&vault_path).map_err(|e| e.to_string())?;
    }
    
    // Extraer extensión del file_name (ahora limpio de .zst si existía)
    let extension = std::path::Path::new(&file_name).extension().and_then(|e| e.to_str()).unwrap_or("");
    let final_name = if !extension.is_empty() && !remote_code.ends_with(extension) {
        format!("{}.{}", remote_code, extension)
    } else {
        remote_code.clone()
    };
    vault_path.push(&final_name);

    fs::write(&vault_path, &buffer).map_err(|e| format!("File write error: {}", e))?;

    // 3. Registrar en Historial
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO document_history (file_name, file_path, file_size, remote_code, source, user_login) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            file_name,
            vault_path.to_string_lossy().to_string(),
            format!("{:.2} MB", buffer.len() as f32 / 1024.0 / 1024.0),
            remote_code,
            "MAILBOX",
            user_login
        ],
    ).map_err(|e| format!("DB Error: {}", e))?;

    let _ = app_handle.emit(
        "mailbox-download-progress",
        serde_json::json!({
            "remote_code": remote_code,
            "progress": 100,
            "status": "completed"
        }),
    );

    Ok(vault_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_mailbox_messages(
    state: State<DbState>,
    user_login: String,
) -> Result<Vec<MailboxMessage>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let repo = MailboxRepository::new(&conn);
    repo.get_all_messages(&user_login)
        .map_err(|e: rusqlite::Error| e.to_string())
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
    let device_secret = repo
        .get_or_create_device_secret()
        .map_err(|e| e.to_string())?;
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

    let final_plaintext =
        plaintext.ok_or("Decryption failed. No valid key found (Secret or MAC).")?;

    let messages: Vec<MailboxMessage> = serde_json::from_slice(&final_plaintext)
        .map_err(|e| format!("Invalid JSON payload: {}", e))?;

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
            Some(user_login.clone()),
        )
        .map_err(|e: rusqlite::Error| e.to_string())?;
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
        user_login,
    )
    .map_err(|e: rusqlite::Error| e.to_string())
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
    repo.update_status(id, &status, tracking_info)
        .map_err(|e: rusqlite::Error| e.to_string())
}

#[tauri::command]
pub fn delete_mailbox_message(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let repo = MailboxRepository::new(&conn);
    repo.delete_message(id)
        .map_err(|e: rusqlite::Error| e.to_string())
}
