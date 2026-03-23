use crate::storage::DbState;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};

// --- Data Models ---

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

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthorizationTicket {
    pub auth_id: String,
    pub payload: String,
    pub content: String,
    pub status: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
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
pub fn sha256_hash_file(file_path: String) -> Result<String, String> {
    crate::sha256::Sha256Service::hash_file(&file_path)
}

#[tauri::command]
pub fn encrypt_device_context(
    context: serde_json::Value,
    secret_key: String,
) -> Result<String, String> {
    crate::sha256::Sha256Service::encrypt_device_context(&context, &secret_key)
}

// --- Commands: Authorization Tickets ---

#[tauri::command]
pub fn register_authorization_ticket(
    state: State<DbState>,
    auth_id: String,
    payload: String,
    content: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO authorization_tickets (auth_id, payload, content) VALUES (?1, ?2, ?3)",
        (auth_id, payload, content),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_authorization_tickets(
    state: State<DbState>,
) -> Result<Vec<AuthorizationTicket>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT auth_id, payload, content, status, created_at, updated_at FROM authorization_tickets ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let tickets = stmt
        .query_map([], |row| {
            Ok(AuthorizationTicket {
                auth_id: row.get(0)?,
                payload: row.get(1)?,
                content: row.get(2)?,
                status: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(tickets)
}
#[tauri::command]
pub fn get_authorization_ticket_by_id(
    state: State<DbState>,
    auth_id: String,
) -> Result<AuthorizationTicket, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT auth_id, payload, content, status, created_at, updated_at FROM authorization_tickets WHERE auth_id = ?1",
        [auth_id],
        |row| {
            Ok(AuthorizationTicket {
                auth_id: row.get(0)?,
                payload: row.get(1)?,
                content: row.get(2)?,
                status: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn update_authorization_ticket_status(
    state: State<DbState>,
    auth_id: String,
    status: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE authorization_tickets SET status = ?1, updated_at = CURRENT_TIMESTAMP WHERE auth_id = ?2",
        (status, auth_id),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_authorization_ticket(state: State<DbState>, auth_id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM authorization_tickets WHERE auth_id = ?1",
        [auth_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn process_hsf_authorization(
    app: tauri::AppHandle,
    state: State<DbState>,
    auth_id: String,
    key: String,
) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    // 1. Obtener el payload encriptado de la tabla authorization_tickets
    let payload: String = conn
        .query_row(
            "SELECT payload FROM authorization_tickets WHERE auth_id = ?1",
            [&auth_id],
            |row| row.get(0),
        )
        .map_err(|_| {
            format!(
                "No se encontró el ticket de autorización para el ID proporcionado: {}",
                auth_id
            )
        })?;

    // 2. Desencriptar el payload usando la llave provista
    let decrypted = crate::crypto::decrypt_string(&payload, &key)
        .map_err(|e| format!("Error al desencriptar el ticket de autorización: {}", e))?;

    // 3. Actualizar el estado a 'Procesado' y GUARDAR el contenido desencriptado
    conn.execute(
        "UPDATE authorization_tickets SET status = 'Procesado', content = ?1, updated_at = CURRENT_TIMESTAMP WHERE auth_id = ?2",
        [&decrypted, &auth_id],
    )
    .map_err(|e| e.to_string())?;

    // 4. Crear una notificación automática en el Mailbox de Seguridad y Sistema
    let notify_content = format!(
        "La solicitud de autorización #{} ha sido procesada y desencriptada exitosamente.",
        auth_id
    );

    // Guardar en DB (Mailbox interno)
    conn.execute(
        "INSERT INTO security_mailbox (sid, content, author, responsible, status, direction) VALUES (?1, ?2, ?3, 'System', 'Approved', 'inbox')",
        (Some(auth_id.clone()), Some(notify_content.clone()), Some("HSF Ticket Seguro".to_string())),
    ).ok();

    // Notificación Nativa (OS)
    crate::remote_control::show_native_notification(&app, "Autorización Aprobada", &notify_content);

    // Emitir evento para refrescar Monitor UI si está abierto
    let _ = app.emit("refresh-monitor-data", ());

    // 5. Devolver la información desencriptada
    Ok(decrypted)
}
