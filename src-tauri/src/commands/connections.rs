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
) -> Result<(), String> {
    let conn = state.0.lock().unwrap();

    let existing_id: Option<i32> = conn
        .query_row(
            "SELECT id FROM connections WHERE name = ?1",
            [&conn_data.name],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(exist_id) = existing_id {
        if let Some(current_id) = conn_data.id {
            if exist_id != current_id {
                return Err(format!("El perfil '{}' ya existe.", conn_data.name));
            }
        } else {
            return Err(format!("El perfil '{}' ya existe.", conn_data.name));
        }
    }

    let connected_int = if conn_data.is_connected.unwrap_or(false) {
        1
    } else {
        0
    };

    if let Some(id) = conn_data.id {
        conn.execute(
            "UPDATE connections SET name=?1, ip_address=?2, port=?3, username=?4, password=?5, wss_host=?6, wss_port=?7, is_connected=?8 WHERE id=?9",
            rusqlite::params![conn_data.name, conn_data.ip_address, conn_data.port, conn_data.username, conn_data.password, conn_data.wss_host, conn_data.wss_port, connected_int, id],
        ).map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "INSERT INTO connections (name, ip_address, port, username, password, wss_host, wss_port, is_connected) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![conn_data.name, conn_data.ip_address, conn_data.port, conn_data.username, conn_data.password, conn_data.wss_host, conn_data.wss_port, connected_int],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_connections(state: tauri::State<'_, DbState>) -> Result<Vec<Connection>, String> {
    let conn = state.0.lock().unwrap();
    let mut stmt = conn.prepare("SELECT id, name, ip_address, port, username, password, last_connected, wss_host, wss_port, is_connected FROM connections ORDER BY id DESC").map_err(|e| e.to_string())?;

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
pub async fn connect_to_server(
    state: tauri::State<'_, DbState>,
    app_handle: AppHandle,
    conn_data: Connection,
    client_id: String,
) -> Result<(), String> {
    let host = conn_data
        .wss_host
        .clone()
        .unwrap_or(conn_data.ip_address.clone());
    let port = conn_data.wss_port.unwrap_or(8443);

    let url = format!(
        "wss://{}:{}/sandra_ws?userId={}&userName={}",
        host, port, client_id, "SDC-User"
    );

    println!("🔌 Iniciando conexión bajo demanda a: {}", url);

    // Update DB status
    let conn = state.0.lock().unwrap();
    // Reset all others
    let _ = conn.execute("UPDATE connections SET is_connected = 0", []);
    if let Some(id) = conn_data.id {
        let _ = conn.execute(
            "UPDATE connections SET is_connected = 1 WHERE id = ?1",
            [id],
        );
    }

    tauri::async_runtime::spawn(async move {
        remote_control::start_remote_listener(url, app_handle).await;
    });

    Ok(())
}

#[tauri::command]
pub async fn disconnect_from_server(
    state: tauri::State<'_, DbState>,
    app_handle: AppHandle,
    conn_data: Connection,
    client_id: String,
) -> Result<(), String> {
    let host = conn_data
        .wss_host
        .clone()
        .unwrap_or(conn_data.ip_address.clone());
    let port = conn_data.wss_port.unwrap_or(8443);

    // Construct Logout Service URL: "https://HOST:PORT/logout:UUID"
    let url = format!("https://{}:{}/logout:{}", host, port, client_id);

    println!("🔌 Desconectando y notificando servicio logout: {}", url);

    // 1. Update DB immediately
    {
        let conn = state.0.lock().unwrap();
        if let Some(id) = conn_data.id {
            let _ = conn.execute(
                "UPDATE connections SET is_connected = 0 WHERE id = ?1",
                [id],
            );
        }
    }

    // 2. Notify Server
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

    // 3. Emit Disconnected
    let _ = app_handle.emit("connection-status", "disconnected");

    Ok(())
}
