use crate::storage::DbState;

use serde_json;
use std::fs;
use tauri::{AppHandle, Emitter};

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
    let file_bytes =
        fs::read(&file_path).map_err(|e| format!("Error leyendo archivo: {}", e))?;

    // 2. Extraer datos para la firma
    let user_name = metadata
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown");
    let stats = crate::commands::monitor::collect_system_stats();
    let mac = stats.mac_address.clone();

    // 3. Alquimia: Inyectar Semilla SDC
    let file_bytes = apply_alquimia_seal_bytes(file_bytes, &file_path, user_name, &mac)?;

    // 4. Compresión Zstd (.zst)
    let file_bytes = zstd::encode_all(&file_bytes[..], 3)
        .map_err(|e| format!("Error comprimiendo (zstd): {}", e))?;

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

    let secret = if hash.len() >= 32 {
        &hash[0..32]
    } else {
        &hash
    };

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
    )
    .map_err(|e| format!("Crypto error: {}", e))?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis()
        .to_string();

    let mut headers = reqwest::header::HeaderMap::new();
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

    // 5. Enviar Multipart adaptado al backend Go (WPanel.SubirArchivos)
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("Client error: {}", e))?;

    let mut file_name = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "upload.sdc".to_string());

    // Añadir extensión .zst si no la tiene (Sandra Industrial Standard)
    if !file_name.ends_with(".zst") {
        file_name.push_str(".zst");
    }

    // Extraer valores para el formulario desde metadata
    let identificador = metadata
        .get("hashcontrol")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let is_git = metadata
        .get("git")
        .and_then(|v| v.as_str())
        .unwrap_or("false");
    let is_return = metadata
        .get("return")
        .and_then(|v| v.as_str())
        .unwrap_or("true");

    // Calulcar Hash Único del Documento (SHA256) antes de subir
    let file_hash_unique = crate::sha256::Sha256Service::hash_bytes(&file_bytes);

    let form = reqwest::multipart::Form::new()
        .text("identificador", identificador.to_string())
        .text("git", is_git.to_string())
        .text("return", is_return.to_string())
        .text("hash_documento", file_hash_unique)
        .part(
            "archivos",
            reqwest::multipart::Part::bytes(file_bytes).file_name(file_name.to_string()),
        );

    let _ = app_handle.emit(
        "upload-progress",
        serde_json::json!({ "loaded": 50, "total": 100, "percent": 50 }),
    );

    let url = format!("https://{}:{}/{}", ip, port, endpoint);
    let res = client
        .post(&url)
        .headers(headers)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Upload error: {}", e))?;

    let _ = app_handle.emit(
        "upload-progress",
        serde_json::json!({ "loaded": 100, "total": 100, "percent": 100 }),
    );

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
pub async fn apply_alquimia_seal(
    file_name: String,
    pdf_base64: String,
    metadata: serde_json::Value,
) -> Result<Vec<u8>, String> {
    use base64::{engine::general_purpose, Engine as _};
    let file_bytes = general_purpose::STANDARD.decode(&pdf_base64)
        .map_err(|e| format!("Base64 Error: {}", e))?;
    
    let user_name = metadata
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown");
    let stats = crate::commands::monitor::collect_system_stats();
    let mac = stats.mac_address.clone();

    apply_alquimia_seal_bytes(file_bytes, &file_name, user_name, &mac)
}

pub fn apply_alquimia_seal_bytes(
    mut file_bytes: Vec<u8>,
    file_path: &str,
    user_name: &str,
    mac: &str,
) -> Result<Vec<u8>, String> {
    if file_path.to_lowercase().ends_with(".pdf") {
        if let Ok(mut doc) = lopdf::Document::load_mem(&file_bytes) {
            if let Ok(info_id) = doc.trailer.get(b"Info") {
                if let Ok(info_dict) = doc
                    .get_object(info_id.as_reference().unwrap())
                    .and_then(|obj| obj.as_dict())
                {
                    let mut new_info = info_dict.clone();
                    new_info.set(
                        "SDC-Seal",
                        lopdf::Object::string_literal(format!(
                            "Firmado por {} ({})>>",
                            user_name, mac
                        )),
                    );
                    doc.objects.insert(
                        info_id.as_reference().unwrap(),
                        lopdf::Object::Dictionary(new_info),
                    );
                }
            }

            let mut output = Vec::new();
            if doc.save_to(&mut output).is_ok() {
                return Ok(output);
            }
        }
    } else {
        let seal_text = format!("SDC-Seal(Firmado por {} ({}))>>", user_name, mac);
        let mut invisible_footer = String::from("\u{FEFF}");

        for &b in seal_text.as_bytes() {
            for bit in (0..8).rev() {
                if (b >> bit) & 1 == 1 {
                    invisible_footer.push('\u{200D}');
                } else {
                    invisible_footer.push('\u{200C}');
                }
            }
        }
        invisible_footer.push('\u{200B}');
        file_bytes.extend_from_slice(invisible_footer.as_bytes());
    }
    
    Ok(file_bytes)
}

#[tauri::command]
pub async fn verify_file_seal(file_path: String) -> Result<serde_json::Value, String> {
    let lower_path = file_path.to_lowercase();

    // 1. Caso PDF: Buscar en metadatos Info
    if lower_path.ends_with(".pdf") {
        if let Ok(file_bytes) = fs::read(&file_path) {
            if let Ok(doc) = lopdf::Document::load_mem(&file_bytes) {
                if let Ok(info_id) = doc.trailer.get(b"Info") {
                    if let Ok(info_dict) = doc
                        .get_object(info_id.as_reference().unwrap())
                        .and_then(|obj| obj.as_dict())
                    {
                        if let Ok(seal_obj) = info_dict.get(b"SDC-Seal") {
                            if let Ok(seal_str) = seal_obj.as_str() {
                                let seal_text = String::from_utf8_lossy(seal_str).into_owned();
                                return Ok(serde_json::json!({
                                    "status": "VALID",
                                    "message": "Sello SDC encontrado en metadatos PDF",
                                    "seal": seal_text
                                }));
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Caso Otros: Buscar firma esteganográfica (ZWNBSP/ZWSP)
    let content_bytes =
        fs::read(&file_path).map_err(|e| format!("Error leyendo archivo: {}", e))?;
    let content = String::from_utf8_lossy(&content_bytes);

    if let Some(seal) = extract_invisible_seal(&content) {
        Ok(serde_json::json!({
            "status": "VALID",
            "message": "Firma esteganográfica encontrada",
            "seal": seal
        }))
    } else {
        Ok(serde_json::json!({
            "status": "NOT_FOUND",
            "message": "No se detectó sello de seguridad Sandra en este archivo"
        }))
    }
}

fn extract_invisible_seal(content: &str) -> Option<String> {
    let start_marker = "\u{FEFF}";
    let end_marker = "\u{200B}";

    let start_idx = content.find(start_marker)?;
    let end_idx = content.find(end_marker)?;

    if start_idx >= end_idx {
        return None;
    }

    let encoded_part = &content[start_idx + start_marker.len()..end_idx];
    let mut decoded_bytes = Vec::new();
    let mut current_byte: u8 = 0;
    let mut bit_count = 0;

    for c in encoded_part.chars() {
        match c {
            '\u{200D}' => {
                // 1
                current_byte = (current_byte << 1) | 1;
                bit_count += 1;
            }
            '\u{200C}' => {
                // 0
                current_byte <<= 1;
                bit_count += 1;
            }
            _ => continue,
        }

        if bit_count == 8 {
            decoded_bytes.push(current_byte);
            current_byte = 0;
            bit_count = 0;
        }
    }

    String::from_utf8(decoded_bytes).ok()
}
