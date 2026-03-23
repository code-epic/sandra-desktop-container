use crate::storage::DbState;
use tauri::{Emitter, State, AppHandle};
use futures_util::StreamExt;
use std::sync::Arc;
use crate::commands::api::{api_get_request, api_get_raw_request, api_post_raw_request};
use super::repository::MailboxRepository;
use super::types::*;

pub struct SyncService;

impl SyncService {
    pub async fn sync(
        state: State<'_, DbState>,
        app_handle: AppHandle,
    ) -> Result<Vec<String>, String> {
        // 1. Obtener conexión activa y credenciales
        let (ip, port, jwt, hash) = {
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
            .map_err(|e| format!("Error de conexión DB: {}", e))?
        };

        let jwt = jwt.ok_or("Sesión expirada (JWT faltante)")?;
        let hash = hash.unwrap_or_default();

        // 2. Obtener cursor incremental
        let cursor = {
            let conn = state.0.lock().map_err(|e| e.to_string())?;
            let repo = MailboxRepository::new(&conn);
            repo.get_sync_cursor()
        };

        // 3. Iniciar stream del manifiesto
        let endpoint = format!("v1/api/sdc/manifest?cursor={}&format=ndjson", urlencoding::encode(&cursor));
        let mut res = api_get_raw_request(state.clone(), ip.clone(), port, endpoint, hash.clone(), Some(jwt.clone())).await?;
        
        if !res.status().is_success() {
            return Err(format!("Error en servidor ({}).", res.status()));
        }

        let mut manifest_items = Vec::new();
        let mut buffer = Vec::new();
        let mut last_updated_at = cursor.clone();

        // 4. Leer manifiesto por chunks
        while let Ok(Some(chunk)) = res.chunk().await {
            buffer.extend_from_slice(&chunk);
            while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
                let line_bytes = buffer.drain(..=pos).collect::<Vec<_>>();
                if let Ok(line) = String::from_utf8(line_bytes) {
                    let trimmed = line.trim();
                    if trimmed.is_empty() { continue; }
                    if let Ok(item) = serde_json::from_str::<SyncResponseItem>(trimmed) {
                        manifest_items.push(item.clone());
                        last_updated_at = item.updated_at.clone();
                    }
                }
            }
        }

        if manifest_items.is_empty() {
            return Ok(vec![]);
        }

        // 5. Filtrar mensajes nuevos y descargar CONCURRENTEMENTE
        let new_items: Vec<_> = {
            let conn = state.0.lock().map_err(|e| e.to_string())?;
            let repo = MailboxRepository::new(&conn);
            manifest_items.into_iter()
                .filter(|item| !repo.message_exists(&item.guid).unwrap_or(false))
                .collect()
        };

        if new_items.is_empty() {
            return Ok(vec![]);
        }

        let state_arc = Arc::new(state.clone());
        let ip_arc = Arc::new(ip);
        let hash_arc = Arc::new(hash);
        let jwt_arc = Arc::new(jwt);

        let mut guids_received = Vec::new();

        // Procesar descargas en paralelo (max 5)
        let mut stream = futures_util::stream::iter(new_items)
            .map(|item| {
                let state = Arc::clone(&state_arc);
                let ip = Arc::clone(&ip_arc);
                let port = port;
                let hash = Arc::clone(&hash_arc);
                let jwt = Arc::clone(&jwt_arc);
                let app = app_handle.clone();

                async move {
                    let msg_endpoint = format!("v1/api/sdc/message/{}", item.guid);
                    let msg_res = api_get_request(
                        State::clone(&state), 
                        (*ip).clone(), 
                        port, 
                        msg_endpoint, 
                        (*hash).clone(), 
                        Some((*jwt).clone())
                    ).await;

                    match msg_res {
                        Ok(data) => {
                            let content_str = serde_json::to_string(&data).unwrap_or_default();
                            let author = data["manifest"]["sender"].as_str().unwrap_or("Unknown").to_string();
                            
                            // Insertar en DB (Serializado por el Mutex interno de DbState)
                            let conn = state.0.lock().map_err(|e| e.to_string())?;
                            let repo = MailboxRepository::new(&conn);
                            repo.insert_message(
                                Some(item.guid.clone()),
                                Some(content_str),
                                Some(author),
                                "Pending",
                                "inbox",
                                None,
                                None
                            ).map_err(|e| e.to_string())?;

                            let _ = app.emit("sync-item-received", &item.guid);
                            Ok::<String, String>(item.guid)
                        }
                        Err(e) => Err(format!("Error descargando {}: {}", item.guid, e))
                    }
                }
            })
            .buffer_unordered(5);

        while let Some(result) = stream.next().await {
            match result {
                Ok(guid) => guids_received.push(guid),
                Err(e) => eprintln!("[Sync] Fallo en item: {}", e),
            }
        }

        // 6. Enviar ACKs por streaming
        if !guids_received.is_empty() {
            let ack_payload = serde_json::json!(guids_received);
            let mut ack_res = api_post_raw_request(
                state.clone(), 
                (*ip_arc).clone(), 
                port, 
                "v1/api/sdc/ack?format=ndjson".to_string(), 
                ack_payload, 
                (*hash_arc).clone(), 
                Some((*jwt_arc).clone())
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
                        }
                    }
                }
            }

            // Actualizar cursor
            let conn = state.0.lock().map_err(|e| e.to_string())?;
            let repo = MailboxRepository::new(&conn);
            repo.update_sync_cursor(&last_updated_at).map_err(|e| e.to_string())?;
        }

        let _ = app_handle.emit("refresh-mailbox", ());
        Ok(guids_received)
    }
}
