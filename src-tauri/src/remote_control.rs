use futures_util::{SinkExt, StreamExt};
use native_tls::TlsConnector;
use serde::Serialize;
use serde_json::Value;
use std::process::Command;
use tauri::{AppHandle, Emitter};
use tokio_tungstenite::tungstenite::Utf8Bytes;
use tokio_tungstenite::{connect_async_tls_with_config, tungstenite::protocol::Message, Connector};

use crate::storage::DbState;
use tauri::Manager;

#[derive(Serialize)]
struct ClientMessage {
    // Si en Go el struct usa `json:"message"`, usa camelCase.
    // Si no tiene tags en Go, usa PascalCase para que coincida con "Message".
    #[serde(rename = "message")]
    message: String,
}

// Modified signature to take AppHandle for emitting events
pub async fn start_remote_listener(
    ws_url: String,
    app_handle: AppHandle,
    connection_id: Option<i64>,
) {
    let mut tls_builder = TlsConnector::builder();
    tls_builder.danger_accept_invalid_certs(true);
    tls_builder.min_protocol_version(Some(native_tls::Protocol::Tlsv12));

    let connector = Connector::NativeTls(tls_builder.build().unwrap());
    let mut attempt_count = 0;

    // Emit initial status
    let _ = app_handle.emit("connection-status", "connecting");

    loop {
        attempt_count += 1;
        println!("🔄 Intentando conectar a: {}", ws_url);

        match connect_async_tls_with_config(&ws_url, None, false, Some(connector.clone())).await {
            Ok((mut ws_stream, _)) => {
                println!("📡 Conectado exitosamente");
                let _ = app_handle.emit("connection-status", "connected");
                attempt_count = 0; // Reset on success

                let initial_payload = ClientMessage {
                    message: "Initial Handshake from Sandra OS".to_string(),
                };

                if let Ok(json_str) = serde_json::to_string(&initial_payload) {
                    if let Err(e) = ws_stream.send(Message::Text(json_str.into())).await {
                        eprintln!("❌ Error enviando mensaje inicial: {}", e);
                    } else {
                        println!("🚀 Mensaje inicial enviado a Go");
                    }
                }

                while let Some(msg) = ws_stream.next().await {
                    match msg {
                        Ok(Message::Text(text)) => process_command(&text, &app_handle),
                        Ok(Message::Close(_)) => {
                            println!("🔌 Servidor cerró la conexión.");
                            let _ = app_handle.emit("connection-status", "disconnected");
                            set_db_disconnected(&app_handle, connection_id);
                            break;
                        }
                        Err(_) => {
                            let _ = app_handle.emit("connection-status", "error");
                            set_db_disconnected(&app_handle, connection_id);
                            break;
                        }
                        _ => {}
                    }
                }
            }
            Err(e) => {
                eprintln!("❌ Error de handshake: {}", e);
                let _ = app_handle.emit("connection-status", "error");
                // Important: If handshake fails, mark as disconnected in DB so UI updates
                set_db_disconnected(&app_handle, connection_id);

                if attempt_count >= 3 {
                    println!("⚠️ Demasiados intentos fallidos. Abortando auto-reconexion rapida.");
                    // In a real app we might want to wait longer or stop.
                    tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
                } else {
                    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                }
            }
        }
    }
}

fn set_db_disconnected(app_handle: &AppHandle, connection_id: Option<i64>) {
    let id = match connection_id {
        Some(i) => i,
        None => return,
    };

    let state = app_handle.state::<DbState>();

    // Bloqueamos y manejamos el resultado por separado
    let lock_result = state.0.lock();

    if let Ok(conn) = lock_result {
        if let Err(e) = conn.execute(
            "UPDATE connections SET is_connected = 0 WHERE id = ?1",
            [id],
        ) {
            println!("Failed to update DB disconnection status: {}", e);
        }
    }
    // Aquí lock_result cae fuera de scope y libera el Mutex automáticamente
}

fn process_command(text: &str, app_handle: &AppHandle) {
    if let Ok(json) = serde_json::from_str::<Value>(text) {
        match json["cmd"].as_str() {
            Some("reboot") => {
                execute_system_reboot();
            }
            Some("status") => {
                // Respond or log
            }
            Some("welcome") => {
                let _ = app_handle.emit("server-welcome", json);
            }
            _ => println!("📩 Mensaje recibido: {}", text),
        }
    }
}

fn execute_system_reboot() {
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("shutdown").args(["/r", "/t", "0"]).spawn();
    }
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        let _ = Command::new("reboot").spawn();
    }
}
