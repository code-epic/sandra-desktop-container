use crate::storage::DbState;
use serde::{Deserialize, Serialize};
use serde_json;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Runtime, Manager};
use sha2::{Digest, Sha256};
use zstd::stream::read::Decoder;

#[derive(Debug, Serialize, Deserialize)]
pub struct WTypeFile {
    pub ruta: String,
    pub archivo: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ManifestFile {
    pub nombre: String,
    pub tipo: String,
    pub tamano_bytes: u64,
    pub sha256: String,
    pub sha256csv: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Manifest {
    pub id_operacion: String,
    pub fecha_generacion: String,
    pub total_archivos: usize,
    pub compresion: String,
    pub archivos: Vec<ManifestFile>,
}

#[tauri::command]
pub async fn procesar_descarga_segura<R: Runtime>(
    app_handle: AppHandle<R>,
    state: tauri::State<'_, DbState>,
    id_nomina: String,
    tracking_id: String,
    ip: String,
    port: u16,
    mut hash: String,
    temp_auth_token: Option<String>,
) -> Result<String, String> {
    let task_id = format!("dl_{}_{}", id_nomina, tracking_id);
    
    // 1. Descargar Manifiesto
    emit_progress(&app_handle, &task_id, 5, "Descargando manifiesto...");
    
    let manifest_payload = WTypeFile {
        ruta: format!("bck-export/nomina/{}", tracking_id),
        archivo: "manifest.json".to_string(),
    };

    let manifest_json = call_api_simple(
        &state,
        &ip,
        port,
        "v1/api/dwscdn",
        serde_json::to_value(manifest_payload).unwrap(),
        &mut hash,
        temp_auth_token.clone(),
    ).await?;

    let manifest: Manifest = serde_json::from_value(manifest_json)
        .map_err(|e| format!("Error parseando manifiesto: {}", e))?;

    // 2. Preparar Directorio
    let mut download_path = app_handle.path().app_data_dir()
        .map_err(|e| format!("Error app_data_dir: {}", e))?;
    download_path.push("nominas");
    download_path.push(&id_nomina);
    download_path.push(&tracking_id);
    
    fs::create_dir_all(&download_path)
        .map_err(|e| format!("Error creando directorios: {}", e))?;

    let total_files = manifest.archivos.len();

    println!("Total de archivos: {}", manifest.archivos.len());
    println!("Manifest recibido: {:?}", manifest);
    
    for (i, archivo) in manifest.archivos.iter().enumerate() {
        let file_progress_start = 10 + (i * 80 / total_files);
        let msg = format!("Descargando {} ({} de {})...", archivo.nombre, i + 1, total_files);
        emit_progress(&app_handle, &task_id, file_progress_start as u32, &msg);

        // 3. Descarga con Streaming, Hash y Zstd
        descargar_y_procesar_archivo(
            &state,
            &app_handle,
            &task_id,
            &ip,
            port,
            &mut hash,
            temp_auth_token.clone(),
            &tracking_id,
            archivo,
            &download_path,
            file_progress_start as u32,
            (80 / total_files) as u32,
            &format!("NOMINA - {} - {}", manifest.id_operacion, tracking_id),
        ).await?;
    }

    emit_progress(&app_handle, &task_id, 100, "Proceso completado con éxito");
    let _ = app_handle.emit("refresh-document-history", ());
    
    Ok(download_path.to_string_lossy().to_string())
}

async fn call_api_simple(
    state: &tauri::State<'_, DbState>,
    ip: &str,
    port: u16,
    endpoint: &str,
    payload: serde_json::Value,
    hash_ref: &mut String,
    token: Option<String>,
) -> Result<serde_json::Value, String> {
    // Reutilizamos la lógica de api_post_request pero sin ser un comando tauri directo
    // Esto es necesario porque necesitamos llamar a la API internamente.
    crate::commands::api::api_post_request(
        state.clone(),
        ip.to_string(),
        port,
        endpoint.to_string(),
        payload,
        hash_ref.clone(),
        token,
    ).await
}

async fn descargar_y_procesar_archivo<R: Runtime>(
    state: &tauri::State<'_, DbState>,
    app_handle: &AppHandle<R>,
    task_id: &str,
    ip: &str,
    port: u16,
    hash_ref: &mut String,
    token: Option<String>,
    tracking_id: &str,
    archivo: &ManifestFile,
    base_path: &PathBuf,
    progress_base: u32,
    progress_range: u32,
    group_name: &str,
) -> Result<(), String> {
    let url = format!("https://{}:{}/v1/api/dwscdnstream", ip, port);
    
    // Obtener hash de la DB si es necesario (lógica duplicada de api.rs para seguridad)
    let mut final_hash = hash_ref.clone();
    if let Ok(conn) = state.0.lock() {
        if let Ok(db_hash) = conn.query_row(
            "SELECT hash FROM connections WHERE ip_address = ?1 AND port = ?2 ORDER BY id DESC LIMIT 1",
            rusqlite::params![ip, port],
            |row| row.get::<_, Option<String>>(0)
        ) {
            if let Some(h) = db_hash {
                if !h.is_empty() {
                    final_hash = h;
                }
            }
        }
    }

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("Error creando cliente: {}", e))?;

    let secret = if final_hash.len() >= 32 { &final_hash[0..32] } else { &final_hash };

    // Headers de seguridad
    let stats = crate::commands::monitor::collect_system_stats();
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
    headers.insert("X-Device-Context", encoded_device_context.parse().unwrap());
    headers.insert("X-Timestamp", timestamp.parse().unwrap());
    headers.insert("Web-API-key", secret.parse().unwrap());
    if let Some(t) = token {
        headers.insert(reqwest::header::AUTHORIZATION, format!("Bearer {}", t).parse().unwrap());
    }

    let payload = WTypeFile {
        ruta: format!("bck-export/nomina/{}", tracking_id),
        archivo: archivo.nombre.clone(),
    };

    println!("Payload enviado: {:?}", payload);

    let res = client
        .post(&url)
        .headers(headers)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Error de red descargando {}: {}", archivo.nombre, e))?;

    if !res.status().is_success() {
        let status = res.status();
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!("Error HTTP {}: {}", status, err_text));
    }

    // Procesamiento en Streaming
    let mut hasher = Sha256::new();
    let mut compressed_data = Vec::new();
    let total_bytes = archivo.tamano_bytes as f64;
    let mut downloaded_bytes = 0u64;

    use futures_util::StreamExt;
    let mut stream = res.bytes_stream();

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| format!("Error en stream: {}", e))?;
        hasher.update(&chunk);
        compressed_data.extend_from_slice(&chunk);
        
        downloaded_bytes += chunk.len() as u64;
        let percent = (downloaded_bytes as f64 / total_bytes * 100.0) as u32;
        let global_progress = progress_base + (percent * progress_range / 100);
        
        if downloaded_bytes % (1024 * 512) == 0 { // Emitir cada 512KB para no saturar
             emit_progress(app_handle, task_id, global_progress, &format!("Descargando {}... {}%", archivo.nombre, percent));
        }
    }

    // Validar Hash SHA256 del archivo comprimido
    let final_hash_val = format!("{:x}", hasher.finalize());
    if final_hash_val != archivo.sha256 {
        return Err(format!("Validación fallida para {}: Hash esperado {}, obtenido {}", archivo.nombre, archivo.sha256, final_hash_val));
    }

    // Descomprimir Zstd
    emit_progress(app_handle, task_id, progress_base + progress_range, &format!("Descomprimiendo {}...", archivo.nombre));
    
    let mut decoder = Decoder::new(&compressed_data[..])
        .map_err(|e| format!("Error inicializando zstd para {}: {}", archivo.nombre, e))?;
    
    let mut decompressed_bytes = Vec::new();
    decoder.read_to_end(&mut decompressed_bytes)
        .map_err(|e| format!("Error descomprimiendo {}: {}", archivo.nombre, e))?;

    // Validar Hash del CSV final (opcional pero recomendado)
    let mut csv_hasher = Sha256::new();
    csv_hasher.update(&decompressed_bytes);
    let csv_hash_val = format!("{:x}", csv_hasher.finalize());
    if csv_hash_val != archivo.sha256csv {
         return Err(format!("Validación fallida del contenido CSV para {}: Hash esperado {}, obtenido {}", archivo.nombre, archivo.sha256csv, csv_hash_val));
    }

    // Guardar archivo final (CSV)
    let final_name = archivo.nombre.replace(".zst", "");
    let mut file_path = base_path.clone();
    file_path.push(&final_name);
    
    let mut file = fs::File::create(&file_path)
        .map_err(|e| format!("Error creando archivo {}: {}", final_name, e))?;
    file.write_all(&decompressed_bytes)
        .map_err(|e| format!("Error escribiendo archivo {}: {}", final_name, e))?;

    // 4. Registrar en Historial
    if let Ok(conn) = state.0.lock() {
        let _ = conn.execute(
            "INSERT INTO document_history (file_name, file_path, file_size, remote_code, source, file_hash, group_name) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                final_name,
                file_path.to_string_lossy().to_string(),
                format!("{:.2} MB", decompressed_bytes.len() as f64 / 1024.0 / 1024.0),
                archivo.sha256csv.chars().take(8).collect::<String>(),
                "GLOBAL",
                csv_hash_val,
                group_name
            ],
        );
    }

    Ok(())
}

fn emit_progress<R: Runtime>(app_handle: &AppHandle<R>, task_id: &str, progress: u32, message: &str) {
    let _ = app_handle.emit("secure-download-progress", serde_json::json!({
        "id": task_id,
        "progress": progress,
        "message": message,
        "status": if progress >= 100 { "finalizado" } else { "running" }
    }));
}
