use crate::storage::DbState;
use serde::{Deserialize, Serialize};
use tauri::State;

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
    pub attachments: Option<Vec<Attachment>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Attachment {
    pub name: String,
    #[serde(rename = "type")]
    pub r#type: String,
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SecurityConfig {
    pub id: i64,
    pub password_format_regex: Option<String>,
    pub reporting_level: Option<String>,
    pub audit_level: Option<String>,
    pub cache_enabled: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProxyRoute {
    pub id: i64,
    pub route_path: String,
    pub target_database: Option<String>,
    pub code: Option<String>,
    pub description: Option<String>,
    pub is_active: bool,
}

// --- Commands: Mailbox ---

#[tauri::command]
pub fn get_mailbox_messages(state: State<DbState>) -> Result<Vec<MailboxMessage>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, sid, content, author, status, tracking_info, responsible, created_at, updated_at, is_read FROM security_mailbox ORDER BY created_at DESC")
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
                attachments: {
                    let info: Option<String> = row.get(5)?;
                    if let Some(json_str) = info {
                        // The JSON uses "type", which maps to "type" field. Rust struct uses r#type.
                        // serde handles this if we use #[serde(rename = "type")] or matching field names.
                        // Since JSON has "type", and struct has r#type, default serde might not map without rename.
                        // Let's assume standard behavior first or add rename if needed.
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

// --- Secure Messaging Logic ---

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
}; // aes-gcm = "0.10.3"
use argon2::{
    password_hash::{PasswordHasher, SaltString},
    Argon2,
};
use std::fs;
use std::io::Write;

const PACKAGE_SALT: &str = "SANDRA_SECURE_CHANNEL_V1";

fn derive_key(mac_address: &str) -> Result<[u8; 32], String> {
    let salt = SaltString::encode_b64(PACKAGE_SALT.as_bytes()).map_err(|e| e.to_string())?;
    let argon2 = Argon2::default();

    // Hash password to get key material
    let password_hash = argon2
        .hash_password(mac_address.as_bytes(), &salt)
        .map_err(|e| e.to_string())?;

    // Extract raw hash bytes (default length is 32 bytes)
    let hash_bytes = password_hash
        .hash
        .ok_or("Argon2 hashing failed to produce output")?;

    // Ensure we have 32 bytes for AES-256
    let mut key = [0u8; 32];
    if hash_bytes.len() >= 32 {
        key.copy_from_slice(&hash_bytes.as_bytes()[..32]);
    } else {
        return Err("Derived key length insufficient".into());
    }

    Ok(key)
}

#[derive(Serialize)]
pub struct IngestReport {
    pub total: usize,
    pub imported: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

#[tauri::command]
pub fn ingest_secure_package(
    state: State<DbState>,
    file_path: String,
) -> Result<IngestReport, String> {
    // 1. Read File
    let encrypted_data = fs::read(&file_path).map_err(|e| format!("Error reading file: {}", e))?;

    // 2. Get Own MAC for Key
    let stats = crate::commands::monitor::collect_system_stats();
    let mac = stats.mac_address;
    if mac == "No MAC Found" || mac == "Unknown MAC" {
        return Err("Cannot decrypt: System MAC address not found.".into());
    }

    let key_bytes = derive_key(&mac)?;
    let key = aes_gcm::Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);

    // 3. Extract Nonce (First 12 bytes) and Ciphertext
    if encrypted_data.len() < 12 {
        return Err("Invalid package format (too short)".into());
    }
    let (nonce_bytes, ciphertext) = encrypted_data.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    // 4. Decrypt
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Decryption failed. Valid MAC/Key required.".to_string())?;

    // 5. Parse JSON
    let messages: Vec<MailboxMessage> =
        serde_json::from_slice(&plaintext).map_err(|e| format!("Invalid JSON payload: {}", e))?;

    // 6. Insert new messages
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut imported = 0;
    let mut skipped = 0;

    for msg in messages {
        let sid = msg.sid.clone().unwrap_or_default();

        // Check existence
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

        // Insert
        let tracking_info = serde_json::to_string(&msg.attachments).unwrap_or("[]".to_string());

        conn.execute(
            "INSERT INTO security_mailbox (sid, content, author, status, responsible, tracking_info) 
             VALUES (?1, ?2, ?3, 'Pending', ?4, ?5)",
            (
                &sid,
                msg.content,
                msg.author,
                msg.responsible,
                tracking_info
            ),
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
    // 1. Serialize messages to JSON
    let plaintext = serde_json::to_vec(&messages).map_err(|e| e.to_string())?;

    // 2. Derive Key for Target MAC
    let key_bytes = derive_key(&target_mac)?;
    let key = aes_gcm::Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);

    // 3. Generate Nonce
    let mut rng = rand::rng();
    let mut nonce_bytes = [0u8; 12];
    use rand::RngCore;
    rng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // 4. Encrypt
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|e| e.to_string())?;

    // 5. Combine Nonce + Ciphertext
    let mut package = Vec::new();
    package.extend_from_slice(&nonce_bytes);
    package.extend_from_slice(&ciphertext);

    // 6. Write File
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
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO security_mailbox (sid, content, author, responsible, status) VALUES (?1, ?2, ?3, ?4, 'Pending')",
        (sid, content, author, responsible),
    )
    .map_err(|e| e.to_string())?;
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
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_mailbox_message(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM security_mailbox WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// --- Commands: Config ---

#[tauri::command]
pub fn get_security_config(state: State<DbState>) -> Result<SecurityConfig, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    // Check if exists, if not create default
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM security_config", [], |row| row.get(0))
        .unwrap_or(0);
    if count == 0 {
        conn.execute("INSERT INTO security_config (password_format_regex, reporting_level, audit_level, cache_enabled) VALUES ('^.{8,}$', 'Medium', 'Standard', 1)", []).map_err(|e| e.to_string())?;
    }

    let config = conn.query_row(
        "SELECT id, password_format_regex, reporting_level, audit_level, cache_enabled FROM security_config LIMIT 1",
        [],
        |row| {
            Ok(SecurityConfig {
                id: row.get(0)?,
                password_format_regex: row.get(1)?,
                reporting_level: row.get(2)?,
                audit_level: row.get(3)?,
                cache_enabled: row.get(4)?,
            })
        },
    ).map_err(|e| e.to_string())?;

    Ok(config)
}

#[tauri::command]
pub fn update_security_config(
    state: State<DbState>,
    password_format_regex: Option<String>,
    reporting_level: Option<String>,
    audit_level: Option<String>,
    cache_enabled: bool,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    // We assume there's only one row, so we update the first one or logic based on ID
    // For simplicity, just update the first row
    conn.execute(
        "UPDATE security_config SET password_format_regex = ?1, reporting_level = ?2, audit_level = ?3, cache_enabled = ?4 WHERE id = (SELECT id FROM security_config LIMIT 1)",
        (password_format_regex, reporting_level, audit_level, cache_enabled),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// --- Commands: Proxy Routes ---

#[tauri::command]
pub fn get_proxy_routes(state: State<DbState>) -> Result<Vec<ProxyRoute>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, route_path, target_database, code, description, is_active FROM security_proxy_routes")
        .map_err(|e| e.to_string())?;

    let routes = stmt
        .query_map([], |row| {
            Ok(ProxyRoute {
                id: row.get(0)?,
                route_path: row.get(1)?,
                target_database: row.get(2)?,
                code: row.get(3)?,
                description: row.get(4)?,
                is_active: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(routes)
}

#[tauri::command]
pub fn create_proxy_route(
    state: State<DbState>,
    route_path: String,
    target_database: Option<String>,
    code: Option<String>,
    description: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO security_proxy_routes (route_path, target_database, code, description, is_active) VALUES (?1, ?2, ?3, ?4, 1)",
        (route_path, target_database, code, description),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_proxy_route(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM security_proxy_routes WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// --- Commands: Crypto ---

#[tauri::command]
pub fn sha256_hash(message: String) -> String {
    crate::sha256::Sha256Service::hash(&message)
}

#[tauri::command]
pub fn hmac_sha256(message: String, key: String) -> Result<String, String> {
    crate::sha256::Sha256Service::hmac(&message, &key)
}

#[tauri::command]
pub fn encrypt_device_context(
    context: serde_json::Value,
    secret_key: String,
) -> Result<String, String> {
    crate::sha256::Sha256Service::encrypt_device_context(&context, &secret_key)
}
