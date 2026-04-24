use std::fs;
use tauri::http::{header::CONTENT_TYPE, Response};
use tauri::{AppHandle, Manager};
use url::Url;

use super::external::proxy_arbitrary_url;
use super::state::PROXY_STATE;
use super::utils::create_error_response;

pub fn serve_local_file(app_handle: &AppHandle, path: &str) -> Response<Vec<u8>> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .expect("Error al obtener AppData");
    let clean_path = path.trim_start_matches('/');

    // 1. Determinar el AppId y el AssetPath inicial
    let parts: Vec<&str> = clean_path.splitn(2, '/').collect();
    let initial_app_segment = if parts.is_empty() { "" } else { parts[0] };
    let asset_path = if parts.len() == 2 { parts[1] } else { "" };

    let mut resolved_id = initial_app_segment.to_string();

    // 2. Intentar buscar el archivo directamente en la carpeta del app_id
    let mut file_path = if asset_path.is_empty() {
        app_dir
            .join("apps")
            .join(&resolved_id)
            .join("dist")
            .join("index.html")
    } else {
        app_dir
            .join("apps")
            .join(&resolved_id)
            .join("dist")
            .join(asset_path)
    };

    // 3. Soporte para Base Path: Si no existe, buscar si el primer segmento es un 'base_path' configurado
    if !file_path.exists() && !resolved_id.is_empty() {
        if let Some(db_state) = app_handle.try_state::<crate::storage::DbState>() {
            if let Ok(conn) = db_state.0.lock() {
                let mut stmt = conn
                    .prepare(
                        "SELECT app_id FROM desktop_apps WHERE base_path = ?1 AND is_installed = 1",
                    )
                    .unwrap();
                let actual_app_id_opt: Option<String> =
                    stmt.query_row([&resolved_id], |row| row.get(0)).ok();

                if let Some(real_id) = actual_app_id_opt {
                    println!(
                        "🎯 [Local Proxy] Refinando ruta: /{} -> App: {} (via base_path match)",
                        resolved_id, real_id
                    );
                    resolved_id = real_id;
                    file_path = if asset_path.is_empty() {
                        app_dir
                            .join("apps")
                            .join(&resolved_id)
                            .join("dist")
                            .join("index.html")
                    } else {
                        app_dir
                            .join("apps")
                            .join(&resolved_id)
                            .join("dist")
                            .join(asset_path)
                    };
                }
            }
        }
    }

    // 4. Fallback final: Si el archivo sigue sin existir, intentar servir index.html (SPA Fallback)
    if !file_path.exists() {
        if std::path::Path::new(path).extension().is_none() && !resolved_id.is_empty() {
            let index_path = app_dir
                .join("apps")
                .join(&resolved_id)
                .join("dist")
                .join("index.html");
            if index_path.exists() {
                file_path = index_path;
            }
        }
    }

    // 5. Si todavia no existe, probar si hay un fallback de Proxy Externo activo (Configurado desde handle_request)
    if !file_path.exists() {
        if let Ok(guard) = PROXY_STATE.lock() {
            if let Some(state) = &*guard {
                if let Some(last_id) = &state.last_app_id {
                    if let Some(target_url) = state.targets.get(last_id) {
                        if let Ok(base_url) = Url::parse(target_url) {
                            if let Ok(full_url) = base_url.join(path.trim_start_matches('/')) {
                                let full_url_str = full_url.to_string();
                                match proxy_arbitrary_url(app_handle, last_id, &full_url_str, None)
                                {
                                    Ok(resp) => return resp,
                                    Err(_) => {}
                                }
                            }
                        }
                    }
                }
            }
        }
        return create_error_response(404, &format!("Local file not found: {:?}", file_path));
    }

    // 6. Servir el archivo final
    match fs::read(&file_path) {
        Ok(content) => {
            let extension = file_path.extension().and_then(|s| s.to_str()).unwrap_or("");
            let mime_type = match extension {
                "html" => "text/html",
                "js" => "application/javascript",
                "css" => "text/css",
                "svg" => "image/svg+xml",
                "png" => "image/png",
                "json" => "application/json",
                "woff" | "woff2" => "font/woff2",
                "ttf" => "font/ttf",
                _ => "application/octet-stream",
            };

            Response::builder()
                .header(CONTENT_TYPE, mime_type)
                .header("Access-Control-Allow-Origin", "*")
                .header("Content-Security-Policy", "default-src 'self' 'unsafe-inline' sandra-app: asset: tauri: data: blob: http: https: ws: wss:;")
                .body(content)
                .unwrap_or_else(|_| create_error_response(500, "Error building response"))
        }
        Err(_) => create_error_response(404, "File not found locally"),
    }
}
