use crate::storage::DbState;
use reqwest::Client;
use tauri::{AppHandle, Emitter};
use serde_json;
use rusqlite;

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
        &hash[0..32]
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

#[tauri::command]
pub async fn api_post_stream_request(
    state: tauri::State<'_, DbState>,
    app_handle: AppHandle,
    ip: String,
    port: u16,
    endpoint: String,
    payload: serde_json::Value,
    mut hash: String,
    temp_auth_token: Option<String>,
    event_channel: String,
) -> Result<(), String> {
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

    let context_str = serde_json::to_string(&context_val).unwrap_or_default();
    use base64::{engine::general_purpose, Engine as _};
    let encoded_b64 = general_purpose::STANDARD.encode(context_str);

    let secret = if hash.len() >= 32 {
        &hash[0..32]
    } else {
        &hash
    };

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
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        "application/x-ndjson".parse().unwrap(),
    );
    headers.insert("Transfer-Encoding", "chunked".parse().unwrap());
    headers.insert("Connection", "keep-alive".parse().unwrap());
    headers.insert("Cache-Control", "no-cache".parse().unwrap());

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

    let mut res = client
        .post(&url)
        .headers(headers)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let status = res.status();

    if !status.is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(format!("HTTP Error {}: {}", status.as_u16(), text));
    }

    let mut buffer = Vec::new();

    while let Some(chunk) = res
        .chunk()
        .await
        .map_err(|e| format!("Stream error: {}", e))?
    {
        buffer.extend_from_slice(&chunk);

        while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
            let line = buffer.drain(..=pos).collect::<Vec<_>>();
            if let Ok(text) = String::from_utf8(line) {
                let text = text.trim();
                if !text.is_empty() {
                    let _ = app_handle.emit(&event_channel, text);
                }
            }
        }
    }

    // Process any remaining bytes
    if !buffer.is_empty() {
        if let Ok(text) = String::from_utf8(buffer) {
            text.trim().to_string();
            let text = text.trim();
            if !text.is_empty() {
                let _ = app_handle.emit(&event_channel, text);
            }
        }
    }

    let _ = app_handle.emit(&format!("{}_done", event_channel), "done");

    Ok(())
}
