use crate::storage::DbState;

use std::fs;
use tauri::{AppHandle, Emitter};
use serde_json;

#[tauri::command]
pub async fn process_and_upload(
    app_handle: AppHandle,
    state: tauri::State<'_, DbState>,
    file_path: String,
    metadata: serde_json::Value,
    ip: String,
    port: u16,
    endpoint: String,
    mut hash: String,
    temp_auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    // 1. Leer archivo
    let mut file_bytes = fs::read(&file_path).map_err(|e| format!("Error leyendo archivo: {}", e))?;

    // 2. Extraer datos para la firma
    let user_name = metadata.get("name").and_then(|v| v.as_str()).unwrap_or("Unknown");
    let stats = crate::commands::monitor::collect_system_stats();
    let mac = stats.mac_address.clone();
    
    // 3. Alquimia: Inyectar Semilla SDC
    if file_path.to_lowercase().ends_with(".pdf") {
        if let Ok(mut doc) = lopdf::Document::load_mem(&file_bytes) {
            // Inyectar en el diccionario Info
            if let Ok(info_id) = doc.trailer.get(b"Info") {
                if let Ok(info_dict) = doc.get_object(info_id.as_reference().unwrap()).and_then(|obj| obj.as_dict()) {
                    let mut new_info = info_dict.clone();
                    // Formato específico solicitado: SDC-Seal(Signed by nombre (mac))>>
                    new_info.set("SDC-Seal", lopdf::Object::string_literal(format!("Signed by {} ({})>>", user_name, mac)));
                    doc.objects.insert(info_id.as_reference().unwrap(), lopdf::Object::Dictionary(new_info));
                }
            }
            
            let mut output = Vec::new();
            if doc.save_to(&mut output).is_ok() {
                file_bytes = output;
            }
        }
    } else {
        // Otros archivos: Firma al final del stream
        let footer = format!("\n--SDC-FOOTER--\nSDC-Seal(Signed by {} ({})>>\n--END-SDC--", user_name, mac);
        file_bytes.extend_from_slice(footer.as_bytes());
    }

    // 4. Preparar Cabeceras de Seguridad (Igual que api_post_request)
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

    let secret = if hash.len() >= 32 { &hash[0..32] } else { &hash };
    
    let context_val = serde_json::json!({
        "os_info": stats.os_info,
        "mac_address": stats.mac_address,
        "network": stats.local_ip
    });
    let context_str = serde_json::to_string(&context_val).unwrap_or_default();
    use base64::{engine::general_purpose, Engine as _};
    let encoded_b64 = general_purpose::STANDARD.encode(context_str);

    let encoded_device_context = crate::sha256::Sha256Service::encrypt_device_context(
        &serde_json::Value::String(encoded_b64),
        secret,
    ).map_err(|e| format!("Crypto error: {}", e))?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis()
        .to_string();

    let mut headers = reqwest::header::HeaderMap::new();
    if let Ok(hv) = encoded_device_context.parse() { headers.insert("X-Device-Context", hv); }
    if let Ok(hv) = timestamp.parse() { headers.insert("X-Timestamp", hv); }
    if let Ok(hv) = secret.parse() { headers.insert("Web-API-key", hv); }

    if let Some(token) = temp_auth_token {
        if let Ok(hv) = format!("Bearer {}", token).parse() {
            headers.insert(reqwest::header::AUTHORIZATION, hv);
        }
    }

    // 5. Enviar Multipart adaptado al backend Go (WPanel.SubirArchivos)
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("Client error: {}", e))?;

    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("upload.sdc");

    // Extraer valores para el formulario desde metadata
    let identificador = metadata.get("hashcontrol").and_then(|v| v.as_str()).unwrap_or("");
    let is_git = metadata.get("git").and_then(|v| v.as_str()).unwrap_or("false");
    let is_return = metadata.get("return").and_then(|v| v.as_str()).unwrap_or("true");

    let form = reqwest::multipart::Form::new()
        .text("identificador", identificador.to_string())
        .text("git", is_git.to_string())
        .text("return", is_return.to_string())
        .part("archivos", reqwest::multipart::Part::bytes(file_bytes).file_name(file_name.to_string()));

    let _ = app_handle.emit("upload-progress", serde_json::json!({ "loaded": 50, "total": 100, "percent": 50 }));

    let url = format!("https://{}:{}/{}", ip, port, endpoint);
    let res = client.post(&url)
        .headers(headers)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Upload error: {}", e))?;

    let _ = app_handle.emit("upload-progress", serde_json::json!({ "loaded": 100, "total": 100, "percent": 100 }));

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
