use std::fs;
use tauri::{AppHandle, Manager};
use tauri::http::{header::CONTENT_TYPE, Response};
use url::Url;

use super::state::PROXY_STATE;
use super::external::proxy_arbitrary_url;
use super::utils::create_error_response;

pub fn serve_local_file(app_handle: &AppHandle, path: &str) -> Response<Vec<u8>> {
    let app_dir = app_handle.path().app_data_dir().expect("Error al obtener AppData");
    let clean_path = path.trim_start_matches('/');

    let file_path = if path.ends_with('/') {
        let app_id = clean_path.trim_end_matches('/');
        app_dir.join("apps").join(app_id).join("dist").join("index.html")
    } else {
        let parts: Vec<&str> = clean_path.splitn(2, '/').collect();
        if parts.len() == 2 {
            let app_id = parts[0];
            let asset_path = parts[1];
            app_dir.join("apps").join(app_id).join("dist").join(asset_path)
        } else {
            app_dir.join("apps").join(clean_path)
        }
    };

    if !file_path.exists() {
        if std::path::Path::new(path).extension().is_none() {
            let clean_path = path.trim_start_matches('/');
            let parts: Vec<&str> = clean_path.splitn(2, '/').collect();
            if !parts.is_empty() {
                let app_id = parts[0];
                let index_path = app_dir.join("apps").join(app_id).join("dist").join("index.html");

                if index_path.exists() {
                    if let Ok(content) = fs::read(&index_path) {
                        return Response::builder()
                            .header(CONTENT_TYPE, "text/html")
                            .header("Access-Control-Allow-Origin", "*")
                            .body(content)
                            .unwrap_or_else(|_| create_error_response(500, "Error building response"));
                    }
                }
            }
        }

        if let Ok(guard) = PROXY_STATE.lock() {
            if let Some(state) = &*guard {
                // If we have a fallback external proxy
                if let Some(last_id) = &state.last_app_id {
                    if let Some(target_url) = state.targets.get(last_id) {
                        println!("🚀 [Local Fallback] Attempting external proxy via last active context: {} (App: {})", target_url, last_id);
                        if let Ok(base_url) = Url::parse(target_url) {
                            if let Ok(full_url) = base_url.join(path.trim_start_matches('/')) {
                                let full_url_str = full_url.to_string();
                                match proxy_arbitrary_url(app_handle, last_id, &full_url_str, None) {
                                    Ok(resp) => return resp,
                                    Err(e) => println!("⚠️ [Local Fallback] Failed remote fetch to {}: {}", full_url_str, e),
                                }
                            }
                        }
                    }
                }
            }
        }

        return create_error_response(404, &format!("Local file not found: {:?}", file_path));
    }

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
