use crate::storage::DbState;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};
use crate::commands::api::{api_get_request, api_get_raw_request, api_post_raw_request};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{
    password_hash::{PasswordHasher, SaltString},
    Argon2,
};
use std::fs;
use std::io::Write;

// --- Data Models ---

#[derive(Debug, Serialize, Deserialize)]
pub struct MailboxMessage {
    pub id: i64,
    pub sid: Option<String>,
    pub content: Option<String>,
    pub author: Option<String>,
    pub status: Option<String>,
    pub tracking_info: Option<String>,
    pub responsible: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub is_read: bool,
    pub direction: Option<String>,
    pub attachments: Option<Vec<Attachment>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Attachment {
    pub name: String,
    #[serde(rename = "type")]
    pub r#type: String,
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncResponseItem {
    pub guid: String,
    pub estatus: String,
    pub updated_at: String,
}

#[derive(Serialize)]
pub struct IngestReport {
    pub total: usize,
    pub imported: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

// --- Constants & Helpers ---

const PACKAGE_SALT: &str = "SANDRA_SECURE_CHANNEL_V1";

fn derive_key(mac_address: &str) -> Result<[u8; 32], String> {
    let salt = SaltString::encode_b64(PACKAGE_SALT.as_bytes()).map_err(|e| e.to_string())?;
    let argon2 = Argon2::default();

    let password_hash = argon2
        .hash_password(mac_address.as_bytes(), &salt)
        .map_err(|e| e.to_string())?;

    let hash_bytes = password_hash
        .hash
        .ok_or("Argon2 hashing failed to produce output")?;

    let mut key = [0u8; 32];
    if hash_bytes.len() >= 32 {
        key.copy_from_slice(&hash_bytes.as_bytes()[..32]);
    } else {
        return Err("Derived key length insufficient".into());
    }

    Ok(key)
}

// --- Commands: Mailbox ---

#[tauri::command]
pub fn get_mailbox_messages(state: State<DbState>) -> Result<Vec<MailboxMessage>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, sid, content, author, status, tracking_info, responsible, created_at, updated_at, is_read, direction FROM security_mailbox ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let messages = stmt
        .query_map([], |row| {
            Ok(MailboxMessage {
                id: row.get(0)?,
                sid: row.get(1)?,
                content: row.get(2)?,
                author: row.get(3)?,
                status: row.get(4)?,
                tracking_info: row.get(5)?,
                responsible: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                is_read: row.get(9)?,
                direction: row.get(10).unwrap_or(Some("inbox".to_string())),
                attachments: {
                    let info: Option<String> = row.get(5)?;
                    if let Some(json_str) = info {
                        serde_json::from_str(&json_str).unwrap_or(None)
                    } else {
                        None
                    }
                },
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(messages)
}

#[tauri::command]
pub async fn sync_mailbox(
    state: State<'_, DbState>,
    app_handle: tauri::AppHandle,
) -> Result<Vec<String>, String> {
    let (ip, port, jwt, hash_opt) = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT ip_address, port, jwt, hash FROM connections WHERE is_connected = 1 LIMIT 1",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, u16>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or("No hay una conexión activa para sincronizar.")?
    };

    let jwt = jwt.ok_or("No hay una sesión activa (JWT faltante).")?;
    let hash = hash_opt.unwrap_or_default();

    let cursor = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT value FROM sync_metadata WHERE key = 'last_mailbox_sync'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
    };

    let endpoint = format!("v1/api/sdc/manifest?cursor={}&format=ndjson", urlencoding::encode(&cursor));
    let mut res = api_get_raw_request(state.clone(), ip.clone(), port, endpoint, hash.clone(), Some(jwt.clone())).await?;
    
    if !res.status().is_success() {
        return Err(format!("Error descargando manifiesto (Status {}).", res.status()));
    }

    let mut guids_to_ack = Vec::new();
    let mut last_updated_at = cursor.clone();
    let mut buffer = Vec::new();

    while let Ok(Some(chunk)) = res.chunk().await {
        buffer.extend_from_slice(&chunk);
        
        while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
            let line_bytes = buffer.drain(..=pos).collect::<Vec<_>>();
            if let Ok(line) = String::from_utf8(line_bytes) {
                let trimmed = line.trim();
                if trimmed.is_empty() { continue; }

                if let Ok(item) = serde_json::from_str::<SyncResponseItem>(trimmed) {
                    let exists = {
                        let conn = state.0.lock().map_err(|e| e.to_string())?;
                        let count: i64 = conn.query_row(
                            "SELECT COUNT(1) FROM security_mailbox WHERE sid = ?1",
                            [&item.guid],
                            |row| row.get(0),
                        ).unwrap_or(0);
                        count > 0
                    };

                    if !exists {
                        let msg_endpoint = format!("v1/api/sdc/message/{}", item.guid);
                        let msg_response = api_get_request(state.clone(), ip.clone(), port, msg_endpoint, hash.clone(), Some(jwt.clone())).await?;
                        
                        let content_str = serde_json::to_string(&msg_response).unwrap_or_default();
                        let author = msg_response["manifest"]["sender"].as_str().unwrap_or("Unknown").to_string();

                        let conn = state.0.lock().map_err(|e| e.to_string())?;
                        conn.execute(
                            "INSERT INTO security_mailbox (sid, content, author, status, direction) VALUES (?1, ?2, ?3, 'Pending', 'inbox')",
                            rusqlite::params![item.guid, content_str, author],
                        ).map_err(|e| format!("Error insertando mensaje local: {}", e))?;
                        
                        let _ = app_handle.emit("sync-item-received", &item.guid);
                    }
                    
                    last_updated_at = item.updated_at.clone();
                    guids_to_ack.push(item.guid);
                }
            }
        }
    }

    if !guids_to_ack.is_empty() {
        let ack_payload = serde_json::json!(guids_to_ack);
        let mut ack_res = api_post_raw_request(
            state.clone(), 
            ip.clone(), 
            port, 
            "v1/api/sdc/ack?format=ndjson".to_string(), 
            ack_payload, 
            hash.clone(), 
            Some(jwt.clone())
        ).await?;
        
        let mut ack_buffer = Vec::new();
        while let Ok(Some(chunk)) = ack_res.chunk().await {
            ack_buffer.extend_from_slice(&chunk);
            while let Some(pos) = ack_buffer.iter().position(|&b| b == b'\n') {
                let line_bytes = ack_buffer.drain(..=pos).collect::<Vec<_>>();
                if let Ok(line) = String::from_utf8(line_bytes) {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        let _ = app_handle.emit("sync-ack-confirmed", trimmed);
                        println!("[ACK] Confirmado por stream: {}", trimmed);
                    }
                }
            }
        }

        let conn = state.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO sync_metadata (key, value) VALUES ('last_mailbox_sync', ?1)",
            [&last_updated_at],
        ).map_err(|e| e.to_string())?;
    }

    let _ = app_handle.emit("refresh-mailbox", ());
    Ok(guids_to_ack)
}

#[tauri::command]
pub fn ingest_secure_package(
    state: State<DbState>,
    file_path: String,
) -> Result<IngestReport, String> {
    let encrypted_data = fs::read(&file_path).map_err(|e| format!("Error reading file: {}", e))?;
    let stats = crate::commands::monitor::collect_system_stats();
    let mac = stats.mac_address;
    if mac == "No MAC Found" || mac == "Unknown MAC" {
        return Err("Cannot decrypt: System MAC address not found.".into());
    }

    let key_bytes = derive_key(&mac)?;
    let key = aes_gcm::Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);

    if encrypted_data.len() < 12 {
        return Err("Invalid package format (too short)".into());
    }
    let (nonce_bytes, ciphertext) = encrypted_data.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Decryption failed. Valid MAC/Key required.".to_string())?;

    let messages: Vec<MailboxMessage> =
        serde_json::from_slice(&plaintext).map_err(|e| format!("Invalid JSON payload: {}", e))?;

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut imported = 0;
    let mut skipped = 0;

    for msg in messages {
        let sid = msg.sid.clone().unwrap_or_default();
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM security_mailbox WHERE sid = ?1",
                [&sid],
                |row| row.get(0),
            )
            .unwrap_or(0);

        if exists > 0 {
            skipped += 1;
            continue;
        }

        let tracking_info = serde_json::to_string(&msg.attachments).unwrap_or("[]".to_string());
        conn.execute(
            "INSERT INTO security_mailbox (sid, content, author, status, responsible, tracking_info) VALUES (?1, ?2, ?3, 'Pending', ?4, ?5)",
            (&sid, msg.content, msg.author, msg.responsible, tracking_info),
        ).map_err(|e| e.to_string())?;
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
    let key_bytes = derive_key(&target_mac)?;
    let key = aes_gcm::Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);

    let mut rng = rand::rng();
    let mut nonce_bytes = [0u8; 12];
    use rand::RngCore;
    rng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|e| e.to_string())?;

    let mut package = Vec::new();
    package.extend_from_slice(&nonce_bytes);
    package.extend_from_slice(&ciphertext);

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
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let unwrapped_dir = direction.unwrap_or_else(|| "outbox".to_string());

    conn.execute(
        "INSERT INTO security_mailbox (sid, content, author, responsible, status, direction) VALUES (?1, ?2, ?3, ?4, 'Pending', ?5)",
        (sid, content, author, responsible, unwrapped_dir),
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_mailbox_status(
    state: State<DbState>,
    id: i64,
    status: String,
    tracking_info: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE security_mailbox SET status = ?1, tracking_info = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?3",
        (status, tracking_info, id),
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_mailbox_message(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM security_mailbox WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
