use futures_util::StreamExt;
use native_tls::TlsConnector;
use serde_json::Value;
use std::process::Command;
use tauri::{AppHandle, Emitter, Manager};
use tokio_tungstenite::{connect_async_tls_with_config, tungstenite::protocol::Message, Connector};

// Modified signature to take AppHandle for emitting events
pub async fn start_remote_listener(ws_url: String, app_handle: AppHandle) {
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

                while let Some(msg) = ws_stream.next().await {
                    match msg {
                        Ok(Message::Text(text)) => process_command(&text, &app_handle),
                        Ok(Message::Close(_)) => {
                            println!("🔌 Servidor cerró la conexión.");
                            let _ = app_handle.emit("connection-status", "disconnected");
                            break;
                        }
                        Err(_) => {
                            let _ = app_handle.emit("connection-status", "error");
                            break;
                        }
                        _ => {}
                    }
                }
            }
            Err(e) => {
                eprintln!("❌ Error de handshake: {}", e);
                let _ = app_handle.emit("connection-status", "error");

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
