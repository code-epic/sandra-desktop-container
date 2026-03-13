use futures_util::{SinkExt, StreamExt};
use native_tls::TlsConnector;
use serde::Serialize;
use serde_json::Value;
use std::process::Command;
use tauri::{AppHandle, Emitter};
use urlencoding::encode;

use tokio_tungstenite::{connect_async_tls_with_config, tungstenite::protocol::Message, Connector};

use crate::commands::monitor::collect_system_stats;
use crate::crypto::encrypt_string;
use crate::storage::DbState;
use tauri::Manager;

#[derive(Serialize)]
struct ClientMessage {
    #[serde(rename = "id")]
    id: String,
    #[serde(rename = "name")]
    name: String,
    #[serde(rename = "message")]
    message: String,
}

// Modified signature to take AppHandle for emitting events
pub async fn start_remote_listener(
    ws_url: String,
    app_handle: AppHandle,
    connection_id: Option<i64>,
    client_id: String,
    secret_hash: String,
) {
    let mut tls_builder = TlsConnector::builder();
    tls_builder.danger_accept_invalid_certs(true);
    tls_builder.min_protocol_version(Some(native_tls::Protocol::Tlsv12));

    let connector = Connector::NativeTls(tls_builder.build().unwrap());
    let mut attempt_count = 0;
    let mut delay = 1;

    // Emit initial status
    update_ws_status(&app_handle, "connecting");

    loop {
        // 1. Recolectar contexto del dispositivo para el Handshake Seguro
        let machine_name = if let Some(state) = app_handle.try_state::<DbState>() {
            let conn = state.0.lock().unwrap();
            conn.query_row(
                "SELECT value FROM config WHERE key = 'machine_name'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap_or_else(|_| "SDC-Node".to_string())
        } else {
            "SDC-Node".to_string()
        };

        let stats = collect_system_stats();
        let context = serde_json::json!({
            "machine_name": machine_name,
            "os_info": stats.os_info,
            "mac_address": stats.mac_address,
            "network": stats.local_ip,
            "hash": secret_hash,
            "timestamp": chrono::Utc::now().to_rfc3339()
        });

        // 2. Cifrar el contexto usando el nuevo Sha256Service
        // Se usa secret_hash como clave de cifrado
        let encrypted_context =
            crate::sha256::Sha256Service::encrypt_device_context(&context, &secret_hash)
                .unwrap_or_else(|_| "ENCRYPTION_ERROR".to_string());

        // 3. Preparar URL con initialMessage cifrado
        let mut final_url = ws_url.clone();
        let encoded_msg = encode(&encrypted_context);

        if final_url.contains('?') {
            final_url = format!(
                "{}&initialMessage={}&hash={}",
                final_url, encoded_msg, secret_hash
            );
        } else {
            final_url = format!(
                "{}?initialMessage={}&hash={}",
                final_url, encoded_msg, secret_hash
            );
        }

        attempt_count += 1;
        println!(
            "Intentando conectar a Sandra Server (Attempt {})...",
            attempt_count
        );

        match connect_async_tls_with_config(&final_url, None, false, Some(connector.clone())).await
        {
            Ok((mut ws_stream, _)) => {
                println!("Conectado exitosamente");
                update_ws_status(&app_handle, "connected");
                attempt_count = 0; // Reset on success
                delay = 1;         // Restaurar el backoff rápido al conectar exitosamente

                // Recolectar estadísticas y cifrarlas para el primer mensaje
                let stats = collect_system_stats();

                if let Ok(json_stats) = serde_json::to_string(&stats) {
                    match encrypt_string(&json_stats, &secret_hash) {
                        Ok(encrypted_data) => {
                            let initial_payload = ClientMessage {
                                id: client_id.clone(),
                                name: "SDC-User".to_string(), // Si quieres dynamic name, pasalo tambien
                                message: encrypted_data,
                            };

                            if let Ok(json_str) = serde_json::to_string(&initial_payload) {
                                if let Err(e) = ws_stream.send(Message::Text(json_str.into())).await
                                {
                                    eprintln!("Error enviando mensaje inicial cifrado: {}", e);
                                } else {
                                    println!("Mensaje inicial cifrado enviado a Go");
                                }
                            }
                        }
                        Err(e) => eprintln!("Error cifrando payload inicial: {}", e),
                    }
                }

                let mut heartbeat_interval = tokio::time::interval(tokio::time::Duration::from_secs(30));

                loop {
                    tokio::select! {
                        msg = ws_stream.next() => {
                            match msg {
                                Some(Ok(Message::Text(text))) => {
                                    process_command(&text, &app_handle, connection_id)
                                }
                                Some(Ok(Message::Pong(_))) => { 
                                    // El servidor Go respondió al Latido
                                }
                                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => {
                                    println!("Conexión perdida o cerrada remotamente (Zombie detectado).");
                                    update_ws_status(&app_handle, "disconnected");
                                    set_db_disconnected(&app_handle, connection_id);
                                    break;
                                }
                                _ => {}
                            }
                        }
                        _ = heartbeat_interval.tick() => {
                            if let Err(e) = ws_stream.send(Message::Ping(vec![].into())).await {
                                eprintln!("Fallo al enviar Ping (Heartbeat Zombie): {}", e);
                                update_ws_status(&app_handle, "error");
                                set_db_disconnected(&app_handle, connection_id);
                                break;
                            }
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("Error de handshake: {}", e);
                update_ws_status(&app_handle, "error");
                // Important: If handshake fails, mark as disconnected in DB so UI updates
                set_db_disconnected(&app_handle, connection_id);

                let sleep_time = std::cmp::min(delay * 2, 60); 
                delay = sleep_time; 

                if attempt_count >= 3 {
                    println!("Demasiados intentos fallidos. Aplicando backoff de {}s.", delay);
                }
                tokio::time::sleep(tokio::time::Duration::from_secs(delay as u64)).await;
            }
        }
    }
}

fn update_ws_status(app_handle: &AppHandle, status: &str) {
    if let Some(state) = app_handle.try_state::<crate::WsStatus>() {
        let mut ws_state = state.0.lock().unwrap();
        *ws_state = status.to_string();
    }
    let _ = app_handle.emit("connection-status", status);
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

fn process_command(text: &str, app_handle: &AppHandle, connection_id: Option<i64>) {
    println!("[WS] Mensaje CRUDO recibido: {}", text);

    if let Ok(json) = serde_json::from_str::<Value>(text) {
        // Estructura Plana: { "type": "chat", "id": "...", "message": "...", "from": "..." }
        let msg_type = json["type"].as_str().unwrap_or("unknown");
        println!("[WS] Tipo de mensaje detectado: {}", msg_type);

        match msg_type {
            "notification" => {
                println!("[WS] Procesando Notificación Nativa...");
                let title = json["title"]
                    .as_str()
                    .or(json["from"].as_str())
                    .unwrap_or("Sandra Alert");
                let body = json["message"].as_str().unwrap_or("Nuevo evento detectado");

                show_native_notification(app_handle, title, body);

                println!("[WS] Notificación enviada al sistema operativo.");

                // También emitimos al frontend
                let _ = app_handle.emit("system-notification", &json);
            }
            "access" => {
                println!("[WS] Acceso concedido, recibiendo JWT...");
                if let Some(jwt) = json["message"].as_str() {
                    // Update Database
                    if let Some(id) = connection_id {
                        let state = app_handle.state::<DbState>();
                        let lock_res = state.0.lock();
                        if let Ok(conn) = lock_res {
                            let _ = conn.execute(
                                "UPDATE connections SET jwt = ?1 WHERE id = ?2",
                                rusqlite::params![jwt, id],
                            );
                            println!(
                                "[WS] JWT guardado en base de datos para la conexión {}",
                                id
                            );
                        }
                    }

                    // Push Notification
                    show_native_notification(
                        app_handle,
                        "Acceso Autorizado",
                        "Se ha otorgado el acceso seguro a la conexión.",
                    );

                    // Global App Event (chat / system messages)
                    let access_payload = serde_json::json!({
                        "type": "chat",
                        "message": "Permisos necesarios otorgados. Acceso seguro establecido.",
                        "from": "SISTEMA",
                        "jwt": jwt,
                    });
                    let _ = app_handle.emit("connection-authorized", &json);
                    let _ = app_handle.emit("chat-message", &access_payload);
                } else {
                    println!("[WS] Mensaje 'access' sin campo 'jwt'");
                }
            }
            "chat" => {
                println!("[WS] Redirigiendo mensaje al sistema de Chat...");
                // Mensaje plano para el componente de Chat
                let _ = app_handle.emit("chat-message", &json);
            }
            "operation" => {
                println!("[WS] Ejecutando operación de sistema...");
                // Acciones de sistema (reboot, updates, etc)
                match json["cmd"].as_str() {
                    Some("reboot") => execute_system_reboot(),
                    Some("status") => { /* Responder con stats */ }
                    _ => println!("Operación desconocida: {:?}", json),
                }
                let _ = app_handle.emit("operation-event", &json);
            }
            "welcome" => {
                println!("[WS] Servidor dio la bienvenida");
                let _ = app_handle.emit("server-welcome", &json);
            }
            "hsf" => {
                println!("[WS] Alta Seguridad Encontrada (HSF)");
                let auth_id = json["message"].as_str().unwrap_or("Desconocido");
                
                show_native_notification(
                    app_handle,
                    "Requerimiento de Alta Seguridad",
                    &format!("Se solicita autorización para el Ticket: {}", auth_id),
                );

                let _ = app_handle.emit("hsf", &json);
            }
            _ => {
                println!("[WS] Tipo desconocido o legacy. Buscando 'cmd'...");
                // Compatibilidad con comandos antiguos (id-less o legacy)
                if let Some(cmd) = json["cmd"].as_str() {
                    println!("[WS] Comando legacy encontrado: {}", cmd);
                    match cmd {
                        "reboot" => execute_system_reboot(),
                        "welcome" => {
                            let _ = app_handle.emit("server-welcome", &json);
                        }
                        _ => println!("Comando legacy detectado: {}", cmd),
                    }
                } else {
                    println!("[WS] No se pudo determinar la acción para el mensaje");
                }
            }
        }
    } else {
        println!("[WS] Falló el parseo de JSON: {}", text);
    }
}

pub fn show_native_notification(app_handle: &AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;

    // 1. Intentar ruta de recursos (Producción)
    let mut icon_path = app_handle
        .path()
        .resource_dir()
        .map(|p| p.join("icons").join("icon.png"))
        .ok();

    // 2. Si no existe, intentar ruta de desarrollo (Source)
    if icon_path.as_ref().map_or(true, |p| !p.exists()) {
        if let Ok(res_dir) = app_handle.path().resource_dir() {
            let dev_path = res_dir.join("..").join("..").join("icons").join("icon.png");
            if dev_path.exists() {
                icon_path = Some(dev_path);
            }
        }
    }

    let mut builder = app_handle.notification().builder();
    builder = builder.title(title).body(body).sound("Default");

    if let Some(path) = icon_path {
        if path.exists() {
            builder = builder.icon(path.to_string_lossy().to_string());
        }
    }

    builder
        .show()
        .unwrap_or_else(|e| println!("Error mostrando notificación: {}", e));
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
