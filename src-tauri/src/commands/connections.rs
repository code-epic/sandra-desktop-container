use crate::remote_control;
use crate::storage::DbState;
use local_ip_address::local_ip;
use reqwest::Client;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

#[derive(Serialize, Deserialize, Debug)]
pub struct Connection {
    pub id: Option<i32>,
    pub name: String,
    pub ip_address: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub last_connected: Option<String>,
    pub wss_host: Option<String>,
    pub wss_port: Option<u16>,
    pub is_connected: Option<bool>,
    pub jwt: Option<String>,
    pub hash: Option<String>,
}

#[tauri::command]
pub async fn get_or_create_client_id(state: tauri::State<'_, DbState>) -> Result<String, String> {
    let conn = state.0.lock().unwrap();

    let existing: Option<String> = conn
        .query_row(
            "SELECT value FROM config WHERE key = 'client_id'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(uuid) = existing {
        return Ok(uuid);
    }

    let new_uuid = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO config (key, value) VALUES ('client_id', ?1)",
        [&new_uuid],
    )
    .map_err(|e| e.to_string())?;

    Ok(new_uuid)
}

#[tauri::command]
pub async fn get_local_ip() -> Result<String, String> {
    match local_ip() {
        Ok(ip) => Ok(ip.to_string()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn verify_connection_status(ip: String, port: u16) -> Result<bool, String> {
    let addr = format!("{}:{}", ip, port);
    let result = tauri::async_runtime::spawn_blocking(move || {
        if let Ok(mut addrs) = addr.to_socket_addrs() {
            if let Some(socket_addr) = addrs.next() {
                if TcpStream::connect_timeout(&socket_addr, Duration::from_millis(1500)).is_ok() {
                    return true;
                }
            }
        }
        false
    })
    .await
    .map_err(|e| e.to_string())?;

    Ok(result)
}

#[tauri::command]
pub async fn save_connection(
    state: tauri::State<'_, DbState>,
    conn_data: Connection,
) -> Result<i32, String> {
    let conn = state.0.lock().unwrap();

    let existing_id_by_name: Option<i32> = conn
        .query_row(
            "SELECT id FROM connections WHERE name = ?1",
            [&conn_data.name],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(exist_id) = existing_id_by_name {
        if let Some(current_id) = conn_data.id {
            if exist_id != current_id {
                return Err(format!("El perfil '{}' ya existe.", conn_data.name));
            }
        } else {
            // Si estamos insertando sin ID pero el nombre ya existe, asumimos que es un update de ese registro
            // o lanzamos error. Por ahora actualizaremos ese registro.
        }
    }

    let connected_int = if conn_data.is_connected.unwrap_or(false) {
        1
    } else {
        0
    };

    let mut hash_val = if let Some(h) = &conn_data.hash {
        h.clone()
    } else {
        let stats = crate::commands::monitor::collect_system_stats();
        let account = conn_data
            .username
            .clone()
            .unwrap_or_else(|| conn_data.name.clone());
        let to_hash = format!("{}{}", stats.mac_address, account);
        crate::sha256::Sha256Service::hash(&to_hash)
    };

    if hash_val.len() > 32 {
        hash_val.truncate(32);
    }

    if let Some(id) = conn_data.id {
        conn.execute(
            "UPDATE connections SET name=?1, ip_address=?2, port=?3, username=?4, password=?5, wss_host=?6, wss_port=?7, is_connected=?8, jwt=?9, hash=?10 WHERE id=?11",
            rusqlite::params![conn_data.name, conn_data.ip_address, conn_data.port, conn_data.username, conn_data.password, conn_data.wss_host, conn_data.wss_port, connected_int, conn_data.jwt, hash_val, id],
        ).map_err(|e| e.to_string())?;
        Ok(id)
    } else if let Some(id) = existing_id_by_name {
        // Caso de "save" sin ID pero con nombre coincidente
        conn.execute(
            "UPDATE connections SET name=?1, ip_address=?2, port=?3, username=?4, password=?5, wss_host=?6, wss_port=?7, is_connected=?8, jwt=?9, hash=?10 WHERE id=?11",
            rusqlite::params![conn_data.name, conn_data.ip_address, conn_data.port, conn_data.username, conn_data.password, conn_data.wss_host, conn_data.wss_port, connected_int, conn_data.jwt, hash_val, id],
        ).map_err(|e| e.to_string())?;
        Ok(id)
    } else {
        conn.execute(
            "INSERT INTO connections (name, ip_address, port, username, password, wss_host, wss_port, is_connected, jwt, hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params![conn_data.name, conn_data.ip_address, conn_data.port, conn_data.username, conn_data.password, conn_data.wss_host, conn_data.wss_port, connected_int, conn_data.jwt, hash_val],
        ).map_err(|e| e.to_string())?;
        let new_id = conn.last_insert_rowid() as i32;
        Ok(new_id)
    }
}

#[tauri::command]
pub async fn update_connection_auth(
    state: tauri::State<'_, DbState>,
    ip: String,
    port: u16,
    token: String,
) -> Result<(), String> {
    let conn = state.0.lock().unwrap();

    let _ = conn.execute(
        "UPDATE connections SET jwt = ?1 WHERE ip_address = ?2 AND port = ?3",
        rusqlite::params![token, ip, port],
    );

    Ok(())
}

#[tauri::command]
pub async fn get_connections(state: tauri::State<'_, DbState>) -> Result<Vec<Connection>, String> {
    let conn = state.0.lock().unwrap();
    let mut stmt = conn.prepare("SELECT id, name, ip_address, port, username, password, last_connected, wss_host, wss_port, is_connected, jwt, hash FROM connections ORDER BY id DESC").map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            let is_connected_val: Option<i32> = row.get(9).ok();
            let is_connected = matches!(is_connected_val, Some(1));

            Ok(Connection {
                id: Some(row.get(0)?),
                name: row.get(1)?,
                ip_address: row.get(2)?,
                port: row.get(3)?,
                username: row.get(4)?,
                password: row.get(5)?,
                last_connected: row.get(6)?,
                wss_host: row.get(7).ok(),
                wss_port: row.get(8).ok(),
                is_connected: Some(is_connected),
                jwt: row.get(10).ok(),
                hash: row.get(11).ok(),
            })
        })
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r.unwrap());
    }
    Ok(list)
}

#[tauri::command]
pub async fn delete_connection(state: tauri::State<'_, DbState>, id: i32) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    conn.execute("DELETE FROM connections WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_setup_status(
    state: tauri::State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    let conn = state.0.lock().unwrap();
    let is_done: String = conn
        .query_row(
            "SELECT value FROM config WHERE key = 'setup_done'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "0".to_string());

    let name: String = conn
        .query_row(
            "SELECT value FROM config WHERE key = 'machine_name'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_default();

    Ok(serde_json::json!({
        "is_done": is_done == "1",
        "machine_name": name
    }))
}

#[tauri::command]
pub async fn save_setup_data(
    state: tauri::State<'_, DbState>,
    name: String,
    description: String,
    area: String,
) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    conn.execute("UPDATE config SET value = '1' WHERE key = 'setup_done'", [])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE config SET value = ?1 WHERE key = 'machine_name'",
        [&name],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE config SET value = ?1 WHERE key = 'machine_description'",
        [&description],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE config SET value = ?1 WHERE key = 'machine_area'",
        [&area],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn connect_to_server(
    state: tauri::State<'_, DbState>,
    conn_task: tauri::State<'_, crate::ConnectionTask>,
    app_handle: AppHandle,
    conn_data: Connection,
    client_id: String,
) -> Result<(), String> {
    // Obtener el nombre descriptivo de la máquina para usarlo en el handshake
    let machine_name: String = {
        let conn = state.0.lock().unwrap();
        conn.query_row(
            "SELECT value FROM config WHERE key = 'machine_name'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "SDC-Node".to_string())
    };

    let host = conn_data
        .wss_host
        .clone()
        .unwrap_or(conn_data.ip_address.clone());
    let port = conn_data.wss_port.unwrap_or(8443);

    // Inyectar el machine_name en la URL
    let url = format!(
        "wss://{}:{}/sandra_ws?userId={}&userName={}",
        host, port, client_id, machine_name
    );

    println!("🔌 Iniciando conexión segura a: {}", url);

    // 1. Abort previous task if any (drop the lock immediately)
    {
        let mut handle_guard = conn_task.0.lock().unwrap();
        if let Some(handle) = handle_guard.take() {
            println!("⚠️ Abortando tarea de conexión anterior...");
            handle.abort();
        }
    }

    // Update DB status
    let mut db_hash_opt: Option<String> = None;
    {
        let conn = state.0.lock().unwrap();
        let _ = conn.execute("UPDATE connections SET is_connected = 0", []);
        if let Some(id) = conn_data.id {
            let _ = conn.execute(
                "UPDATE connections SET is_connected = 1 WHERE id = ?1",
                [id],
            );
            if let Ok(h) =
                conn.query_row("SELECT hash FROM connections WHERE id = ?1", [id], |row| {
                    row.get::<_, Option<String>>(0)
                })
            {
                db_hash_opt = h;
            }
        }
    }

    // Capture IDs for the background thread
    let conn_id_i64 = conn_data.id.map(|n| n as i64);

    // Obtener el hash desde DB o generar (priorizando DB > parámetro > nuevo)
    let secret_hash = if let Some(h) = db_hash_opt.filter(|h| !h.is_empty()) {
        h
    } else if let Some(h) = conn_data.hash.clone().filter(|h| !h.is_empty()) {
        h
    } else {
        let stats = crate::commands::monitor::collect_system_stats();
        let account = conn_data
            .username
            .clone()
            .unwrap_or_else(|| conn_data.name.clone());
        crate::sha256::Sha256Service::hash(&format!("{}{}", stats.mac_address, account))
    };

    // 2. Spawn new task and save handle
    let handle = tauri::async_runtime::spawn(async move {
        remote_control::start_remote_listener(url, app_handle, conn_id_i64, client_id, secret_hash)
            .await;
    });

    {
        let mut task_guard = conn_task.0.lock().unwrap();
        *task_guard = Some(handle);
    }

    Ok(())
}

#[tauri::command]
pub async fn disconnect_from_server(
    state: tauri::State<'_, DbState>,
    conn_task: tauri::State<'_, crate::ConnectionTask>,
    app_handle: AppHandle,
    conn_data: Connection,
    client_id: String,
) -> Result<(), String> {
    // 1. Abort background task immediately
    {
        let mut task_guard = conn_task.0.lock().unwrap();
        if let Some(handle) = task_guard.take() {
            println!("⏹️ Deteniendo listener background...");
            handle.abort();
        }
    }

    let host = conn_data
        .wss_host
        .clone()
        .unwrap_or(conn_data.ip_address.clone());
    let port = conn_data.wss_port.unwrap_or(8443);

    // Construct Logout Service URL: "https://HOST:PORT/logout:UUID"
    let url = format!("https://{}:{}/logout:{}", host, port, client_id);

    println!("🔌 Desconectando y notificando servicio logout: {}", url);

    // 2. Update DB immediately
    {
        let conn = state.0.lock().unwrap();
        if let Some(id) = conn_data.id {
            let _ = conn.execute(
                "UPDATE connections SET is_connected = 0 WHERE id = ?1",
                [id],
            );
        }
    }

    // 3. Notify Server
    let url_clone = url.clone();
    tauri::async_runtime::spawn(async move {
        let client = Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(Duration::from_secs(5))
            .build();

        if let Ok(c) = client {
            let _ = c.get(&url_clone).send().await;
        }
    });

    // 4. Emit Disconnected
    let _ = app_handle.emit("connection-status", "disconnected");

    Ok(())
}

#[tauri::command]
pub async fn get_hash_preview(account_name: String) -> Result<String, String> {
    let stats = crate::commands::monitor::collect_system_stats();
    let to_hash = format!("{}{}", stats.mac_address, account_name);
    let mut hash = crate::sha256::Sha256Service::hash(&to_hash);
    if hash.len() > 32 {
        hash.truncate(32);
    }
    Ok(hash)
}

#[tauri::command]
pub async fn api_post_request(
    state: tauri::State<'_, DbState>,
    ip: String,
    port: u16,
    endpoint: String,
    payload: serde_json::Value,
    mut hash: String,
    temp_auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    let url = format!("https://{}:{}/{}", ip, port, endpoint);

    // Replace hash with DB value if found
    if let Ok(conn) = state.0.lock() {
        if let Ok(db_hash) = conn.query_row(
            "SELECT hash FROM connections WHERE ip_address = ?1 AND port = ?2 ORDER BY id DESC LIMIT 1",
            rusqlite::params![ip, port],
            |row| row.get::<_, Option<String>>(0)
        ) {
            if let Some(h) = db_hash {
                if !h.is_empty() {
                    hash = h;
                }
            }
        }
    }

    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("Client builder error: {}", e))?;

    // Device Context
    let stats = crate::commands::monitor::collect_system_stats();
    let context_val = serde_json::json!({
        "os_info": stats.os_info,
        "mac_address": stats.mac_address,
        "network": stats.local_ip
    });

    // El ejemplo Typescript aplica btoa(JSON.stringify(context))
    let context_str = serde_json::to_string(&context_val).unwrap_or_default();
    use base64::{engine::general_purpose, Engine as _};
    let encoded_b64 = general_purpose::STANDARD.encode(context_str);

    // Crypto key consists of LAST 32 digits of hash (to match Go's key[len-32:])
    let secret = if hash.len() >= 32 {
        &hash[hash.len() - 32..]
    } else {
        &hash
    };

    // Obtenemos Device-Context Cifrado (Already B64 from encrypt_device_context)
    let encoded_device_context = crate::sha256::Sha256Service::encrypt_device_context(
        &serde_json::Value::String(encoded_b64),
        secret,
    )
    .map_err(|e| format!("Crypto error: {}", e))?;

    // Timestamp Unix
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis()
        .to_string();

    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        "application/json".parse().unwrap(),
    );

    if let Ok(hv) = encoded_device_context.parse() {
        headers.insert("X-Device-Context", hv);
    }
    if let Ok(hv) = timestamp.parse() {
        headers.insert("X-Timestamp", hv);
    }
    if let Ok(hv) = secret.parse() {
        headers.insert("Web-API-key", hv);
    }

    if let Some(token) = temp_auth_token {
        if let Ok(hv) = format!("Bearer {}", token).parse() {
            headers.insert(reqwest::header::AUTHORIZATION, hv);
        }
    }

    println!("Headers: {:?}", headers);
    let res = client
        .post(&url)
        .headers(headers)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let status = res.status();
    let text = res.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(format!("HTTP Error {}: {}", status.as_u16(), text));
    }

    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(json) => Ok(json),
        Err(_) => Ok(serde_json::Value::String(text)),
    }
}
