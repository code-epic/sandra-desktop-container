use tauri::http::{Request, Response};
use tauri::AppHandle;
use url::Url;

use super::external::proxy_arbitrary_url;
use super::local::serve_local_file;
use super::remote::{
    get_active_connection, is_app_proxy_required, proxy_to_remote,
};
use super::state::{ExternalProxyState, PROXY_STATE};
use super::utils::create_error_response;

pub fn handle_request(app_handle: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri = request.uri();
    let path = uri.path();

    println!(
        "🔍 Req: {} | Referer: {:?}",
        path,
        request.headers().get("referer")
    );

    // 0. Bypass Proxy
    if path.starts_with("/bypass-proxy/") {
        let query = uri.query().unwrap_or("");
        let relative_segment = path.trim_start_matches("/bypass-proxy/");
        let parts: Vec<&str> = relative_segment.splitn(2, '/').collect();
        let app_id = parts[0].to_string();

        let target_url_opt = if let Some(t) = query.strip_prefix("target=") {
            let decoded = urlencoding::decode(t).unwrap_or(std::borrow::Cow::Borrowed(t));
            Some(decoded.to_string())
        } else {
            if let Ok(guard) = PROXY_STATE.lock() {
                guard
                    .as_ref()
                    .and_then(|state| state.targets.get(&app_id).cloned())
            } else {
                None
            }
        };

        if let Some(target_url) = target_url_opt {
            if query.contains("target=") {
                if let Ok(mut guard) = PROXY_STATE.lock() {
                    let state = guard.get_or_insert_with(ExternalProxyState::default);
                    state.targets.insert(app_id.clone(), target_url.clone());
                    state.last_app_id = Some(app_id.clone());
                }
            }

            let sub_path = if parts.len() > 1 { parts[1] } else { "" };
            let normalized_sub_path = if sub_path.starts_with('/') {
                sub_path.to_string()
            } else {
                format!("/{}", sub_path)
            };

            if let Ok(base) = Url::parse(&target_url) {
                let base_path = base.path();

                // Fix: evitar duplicación de path
                let final_path = if normalized_sub_path.is_empty() || normalized_sub_path == "/" {
                    String::new()
                } else if normalized_sub_path.starts_with(base_path) {
                    normalized_sub_path[base_path.len()..].to_string()
                } else {
                    normalized_sub_path
                };

                let target_base = target_url.trim_end_matches('/');
                let final_path_with_slash = if final_path.starts_with('/') { 
                    final_path.clone() 
                } else { 
                    format!("/{}", final_path) 
                };
                let remote_url = format!("{}{}", target_base, final_path_with_slash);

                println!(
                    "🚧 [Bypass] Base: {} + sub_path: {} = {}",
                    base.path(),
                    final_path,
                    remote_url
                );

                match super::bypass::proxy_bypass_url(
                    app_handle,
                    &app_id,
                    &remote_url,
                    request,
                ) {
                    Ok(resp) => return resp,
                    Err(e) => {
                        return create_error_response(502, &format!("Bypass Error: {}", e))
                    }
                }
            }
        }
    }

    // 0b. Bypass Proxy para requests subsecuentes (detectados por Referer)
    if let Some(referer) = request
        .headers()
        .get("referer")
        .and_then(|v| v.to_str().ok())
    {
        if referer.contains("/bypass-proxy/") {
            // Extraer app_id del referer
            if let Some(start) = referer.find("/bypass-proxy/") {
                let after = &referer[start + 14..]; // después de "/bypass-proxy/"
                if let Some(end) = after.find('/') {
                    let app_id = &after[..end];

                    // Obtener target_url del estado
                    let target_url = if let Ok(guard) = PROXY_STATE.lock() {
                        guard
                            .as_ref()
                            .and_then(|state| state.targets.get(app_id).cloned())
                    } else {
                        None
                    };

                    if let Some(target) = target_url {
                        // Construir URL remota (con normalización para evitar duplicación)
                        let normalized_path = if path.starts_with('/') {
                            path.to_string()
                        } else {
                            format!("/{}", path)
                        };

                        let target_url_parsed = Url::parse(&target).unwrap();
                        let base_path = target_url_parsed.path();

                        let final_path = if normalized_path == "/" {
                            String::new()
                        } else if normalized_path.starts_with(base_path) {
                            normalized_path[base_path.len()..].to_string()
                        } else {
                            normalized_path
                        };

                        let target_base = target.trim_end_matches('/');
                        let final_path_with_slash = if final_path.starts_with('/') { 
                            final_path.clone() 
                        } else { 
                            format!("/{}", final_path) 
                        };
                        let remote_url = format!("{}{}", target_base, final_path_with_slash);

                        println!("🚧 [Bypass-Referer] {} -> {}", path, remote_url);

                        match super::bypass::proxy_bypass_url(
                            app_handle,
                            app_id,
                            &remote_url,
                            request,
                        ) {
                            Ok(resp) => return resp,
                            Err(e) => {
                                return create_error_response(502, &format!("Bypass Error: {}", e))
                            }
                        }
                    }
                }
            }
        }
    }

    // 0c. External Proxy (original)
    if path.starts_with("/external-proxy/") {
        let query = uri.query().unwrap_or("");
        let relative_segment = path.trim_start_matches("/external-proxy/");
        let parts: Vec<&str> = relative_segment.splitn(2, '/').collect();
        let app_id = parts[0].to_string();

        let target_url_opt = if let Some(t) = query.strip_prefix("target=") {
            let decoded = urlencoding::decode(t).unwrap_or(std::borrow::Cow::Borrowed(t));
            Some(decoded.to_string())
        } else {
            if let Ok(guard) = PROXY_STATE.lock() {
                guard
                    .as_ref()
                    .and_then(|state| state.targets.get(&app_id).cloned())
            } else {
                None
            }
        };

        if let Some(target_url) = target_url_opt {
            if query.contains("target=") {
                if let Ok(mut guard) = PROXY_STATE.lock() {
                    let state = guard.get_or_insert_with(ExternalProxyState::default);
                    state.targets.insert(app_id.clone(), target_url.clone());
                    state.last_app_id = Some(app_id.clone());
                }
            }

            let sub_path = if parts.len() > 1 { parts[1] } else { "" };
            let base_href = format!("/external-proxy/{}/", app_id);

            if let Ok(base) = Url::parse(&target_url) {
                let final_path = if sub_path.is_empty() { "" } else { sub_path };
                if let Ok(remote_full) = base.join(final_path) {
                    let remote_str = remote_full.to_string();
                    match proxy_arbitrary_url(app_handle, &app_id, &remote_str, Some(base_href)) {
                        Ok(resp) => return resp,
                        Err(e) => {
                            return create_error_response(502, &format!("Proxy Error: {}", e))
                        }
                    }
                }
            }
        }
    }

    // 1. Discriminación por Referer para navegaciones subsecuentes en proxies externos
    if let Some(referer) = request
        .headers()
        .get("referer")
        .and_then(|v| v.to_str().ok())
    {
        if referer.contains("/external-proxy") {
            if let Some(target_start) = referer.find("target=") {
                let encoded_target = &referer[target_start + 7..];
                let end = encoded_target.find('&').unwrap_or(encoded_target.len());
                let clean_encoded = &encoded_target[..end];
                let decoded_target = urlencoding::decode(clean_encoded)
                    .unwrap_or(std::borrow::Cow::Borrowed(clean_encoded));

                // Extract app_id from referer
                let app_id = referer
                    .split("/external-proxy/")
                    .nth(1)
                    .and_then(|s| s.split('?').next())
                    .unwrap_or("unknown");

                if let Ok(base_url) = Url::parse(&decoded_target) {
                    if let Ok(full_url) = base_url.join(path.trim_start_matches('/')) {
                        let full_url_str = full_url.to_string();
                        match proxy_arbitrary_url(app_handle, app_id, &full_url_str, None) {
                            Ok(resp) => return resp,
                            Err(e) => println!("⚠️ Failed to proxy via referer: {}", e),
                        }
                    }
                }
            }
        }
    }

    // 2. API PROXY (Contains "v1")
    if path.contains("v1") {
        if request.method().as_str() == "OPTIONS" {
            return Response::builder()
                .status(200)
                .header("Access-Control-Allow-Origin", "*")
                .header(
                    "Access-Control-Allow-Methods",
                    "GET, POST, PUT, DELETE, OPTIONS, PATCH",
                )
                .header("Access-Control-Allow-Headers", "*")
                .header("Access-Control-Max-Age", "86400")
                .body(Vec::new())
                .unwrap();
        }

        let referer_opt = request
            .headers()
            .get("referer")
            .and_then(|v| v.to_str().ok());
        let mut should_proxy = false;
        let mut app_id_context = String::new();

        if let Some(referer) = referer_opt {
            let after_scheme_opt = referer
                .strip_prefix("sandra-app://127.0.0.1/")
                .or_else(|| referer.strip_prefix("sandra-app://localhost/"))
                .or_else(|| referer.strip_prefix("http://sandra-app.localhost/"))
                .or_else(|| referer.strip_prefix("https://sandra-app.localhost/"));
            if let Some(after_scheme) = after_scheme_opt {
                let app_id_candidates = if after_scheme.starts_with("external-proxy/") {
                    let part = after_scheme.strip_prefix("external-proxy/").unwrap_or("");
                    part.split_once('?').map(|(id, _)| id).unwrap_or(part)
                } else {
                    after_scheme
                        .split_once('/')
                        .map(|(id, _)| id)
                        .unwrap_or(after_scheme)
                };
                let app_id = app_id_candidates.trim_end_matches('/');
                app_id_context = app_id.to_string();

                if is_app_proxy_required(app_handle, app_id) {
                    should_proxy = true;
                }
            }
        } else {
            if let Ok(guard) = PROXY_STATE.lock() {
                if let Some(state) = &*guard {
                    if let Some(last_id) = &state.last_app_id {
                        app_id_context = last_id.to_string();
                        if is_app_proxy_required(app_handle, last_id) {
                            should_proxy = true;
                        }
                    }
                }
            }
        }

        if should_proxy {
            if let Some(active_conn) = get_active_connection(app_handle) {
                match proxy_to_remote(app_handle, &app_id_context, active_conn, request) {
                    Ok(response) => return response,
                    Err(e) => {
                        return create_error_response(
                            502,
                            format!("Proxy Error (Remote Unreachable): {}", e).as_str(),
                        );
                    }
                }
            }
        }
    }

    // 3. Local Fallback
    serve_local_file(app_handle, path)
}
