use crate::commands::connections::Connection;
use crate::storage::DbState;
use rusqlite::OptionalExtension;
use std::fs;

use tauri::http::{header::CONTENT_TYPE, Request, Response};
use tauri::{AppHandle, Manager};
use url::Url;

// Extensiones que SIEMPRE deben servirse desde el sistema de archivos local

// Global Context for "Sticky" External Sessions (Solves missing Referer in iframes)
use std::sync::Mutex;

#[derive(Clone, Debug)]
struct ExternalContext {
    target_url: String,
    app_id: String,
}

static LAST_EXTERNAL_TARGET: Mutex<Option<ExternalContext>> = Mutex::new(None);

pub fn handle_request(app_handle: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri = request.uri();
    let path = uri.path();

    // DEBUG: Ver qué llega realmente

    println!(
        "🔍 Req: {} | Referer: {:?}",
        path,
        request.headers().get("referer")
    );

    // 0. Caso Especial: Proxy para URLs Externas (Bypass X-Frame-Options)
    // Uso: sandra-app://localhost/external-proxy/{APP_ID}?target=https://google.com
    if path.starts_with("/external-proxy/") {
        let query = uri.query().unwrap_or("");

        // Helper to extract clean path: /external-proxy/ejercito/foo -> ejercito/foo
        let relative_segment = path.trim_start_matches("/external-proxy/");
        let parts: Vec<&str> = relative_segment.splitn(2, '/').collect();
        let app_id = parts[0].to_string(); // "ejercito"

        // Determine Target URL
        let target_url_opt = if let Some(t) = query.strip_prefix("target=") {
            let decoded = urlencoding::decode(t).unwrap_or(std::borrow::Cow::Borrowed(t));
            Some(decoded.to_string())
        } else {
            // Check Context
            if let Ok(guard) = LAST_EXTERNAL_TARGET.lock() {
                guard
                    .as_ref()
                    .filter(|c| c.app_id == app_id)
                    .map(|c| c.target_url.clone())
            } else {
                None
            }
        };

        if let Some(target_url) = target_url_opt {
            // Update Context if it came from query
            if query.contains("target=") {
                if let Ok(mut guard) = LAST_EXTERNAL_TARGET.lock() {
                    *guard = Some(ExternalContext {
                        target_url: target_url.clone(),
                        app_id: app_id.clone(),
                    });
                    println!(
                        "🧠 [Context] Set External Target: {} (App: {})",
                        target_url, app_id
                    );
                }
            }

            // Calculate Remote URL
            // If path has more than just app_id (e.g. /external-proxy/ejercito/styles.css)
            // We need to strip "/external-proxy/{app_id}" and join to target.
            let sub_path = if parts.len() > 1 { parts[1] } else { "" };

            // Construct base href for injection (MUST end in slash)
            // e.g. /external-proxy/ejercito/
            let base_href = format!("/external-proxy/{}/", app_id);

            if let Ok(base) = Url::parse(&target_url) {
                // Fix: join properly handles leading slashes or empty sub_path
                let final_path = if sub_path.is_empty() { "" } else { sub_path };

                if let Ok(remote_full) = base.join(final_path) {
                    let remote_str = remote_full.to_string();
                    println!("🚀 [External Proxy] Routing: {} -> {}", path, remote_str);

                    // We only inject Base HREF if it's potentially an HTML request (root or explicit .html)
                    // But actually, Angular can be loaded via deep link. Safer to inject if it's HTML content type.
                    // Pass it as Some, proxy_arbitrary_url will only use it if content-type matches.
                    match proxy_arbitrary_url(&remote_str, Some(base_href)) {
                        Ok(resp) => return resp,
                        Err(e) => {
                            return create_error_response(502, &format!("Proxy Error: {}", e))
                        }
                    }
                }
            }
        }
    }

    // 1. Discriminación por Referer (Navegación dentro de un sitio externo proxificado)
    // Si la petición viene referenciada por una página que es un proxy externo (ej: google.com),
    // debemos asumir que cualquier petición subsiguiente (imágenes, XHR, búsquedas locales como /search)
    // pertenece a ese contexto externo y redirigirla allá, IGNORANDO la conexión local de BD.
    if let Some(referer) = request
        .headers()
        .get("referer")
        .and_then(|v| v.to_str().ok())
    {
        if referer.contains("/external-proxy") {
            // Formato esperado: .../external-proxy?target=https%3A%2F%2Fgoogle.com
            if let Some(target_start) = referer.find("target=") {
                let encoded_target = &referer[target_start + 7..]; // 7 len of "target="
                                                                   // Limpiar resto de parametros si los hubiese
                let end = encoded_target.find('&').unwrap_or(encoded_target.len());
                let clean_encoded = &encoded_target[..end];

                let decoded_target = urlencoding::decode(clean_encoded)
                    .unwrap_or(std::borrow::Cow::Borrowed(clean_encoded));

                // Unir Base URL Externa + Path actual
                if let Ok(base_url) = Url::parse(&decoded_target) {
                    if let Ok(full_url) = base_url.join(path.trim_start_matches('/')) {
                        let full_url_str = full_url.to_string();
                        println!(
                            "🌍 [Auto-Proxy Context] Redirecting: {} -> {}",
                            path, full_url_str
                        );

                        match proxy_arbitrary_url(&full_url_str, None) {
                            Ok(resp) => return resp,
                            Err(e) => println!("⚠️ Failed to proxy via referer: {}", e),
                        }
                    }
                }
            }
        }
    }

    // A) Intentar Contexto Externo (Sticky Session)
    // Si el usuario navegó antes a Google, asumimos que sigue ahí para peticiones dinámicas (ej: /search, /complete/search)
    // EXCLUIMOS /v1/ para que sea manejado por el API PROXY lógico siguiente (al túnel)
    if !path.contains("/v1/") {
        if let Ok(guard) = LAST_EXTERNAL_TARGET.lock() {
            if let Some(ctx) = &*guard {
                let target_url = &ctx.target_url;
                if let Ok(base_url) = Url::parse(target_url) {
                    if let Ok(full_url) = base_url.join(path.trim_start_matches('/')) {
                        let full_url_str = full_url.to_string();
                        // NOTE: This fallback might compete with the new /external-proxy/ logic
                        // but since we checked path.starts_with("/external-proxy") first, this handles
                        // legacy requests or files at root (e.g. /styles.css directly at root)
                        println!(
                            "🚀 [Context Fallback Dynamic] Attemting to proxy dynamic req -> {}",
                            full_url_str
                        );
                        // No base_href injection for pure assets?
                        // Actually, if it's an HTML file (rare but possible), it might need it,
                        // but we don't know the app_id easily here unless we check ctx.app_id.
                        // Let's assume generic assets don't need base href rewrite.
                        if let Ok(resp) = proxy_arbitrary_url(&full_url_str, None) {
                            return resp;
                        } else {
                            println!(
                                "⚠️ [Context Fallback] Failed remote fetch to {}",
                                full_url_str
                            );
                        }
                    } else {
                        println!(
                            "⚠️ [Context Fallback] URL Join Failed: {:?} + {:?}",
                            base_url, path
                        );
                    }
                } else {
                    println!(
                        "⚠️ [Context Fallback] Base URL Parse Failed: {}",
                        target_url
                    );
                }
            }
        }
    }

    // 2. API PROXY (Only if path contains "v1")
    // Todo lo que contenga "v1" es tráfico de Backend -> Proxy Remoto (si la App lo requiere y hay conexión)
    if path.contains("v1") {
        // Intentar extraer App ID del Referer para saber si requiere proxy
        let referer_opt = request
            .headers()
            .get("referer")
            .and_then(|v| v.to_str().ok());
        let mut should_proxy = false;

        if let Some(referer) = referer_opt {
            // Referer format: sandra-app://127.0.0.1/{APP_ID}/... OR sandra-app://localhost/{APP_ID}/...
            let after_scheme_opt = referer
                .strip_prefix("sandra-app://127.0.0.1/")
                .or_else(|| referer.strip_prefix("sandra-app://localhost/"));

            if let Some(after_scheme) = after_scheme_opt {
                // Check format: external-proxy/{APP_ID}?target=...
                let app_id_candidates = if after_scheme.starts_with("external-proxy/") {
                    let part = after_scheme.strip_prefix("external-proxy/").unwrap_or("");
                    // Split by ? to ignore query params, or / to ignore path
                    part.split_once('?').map(|(id, _)| id).unwrap_or(part)
                } else {
                    // Standard format: {APP_ID}/path...
                    after_scheme
                        .split_once('/')
                        .map(|(id, _)| id)
                        .unwrap_or(after_scheme)
                };

                let app_id = app_id_candidates.trim_end_matches('/'); // Cleanup trailing slash if any

                // Consultar si la App requiere Proxy
                if is_app_proxy_required(app_handle, app_id) {
                    should_proxy = true;
                }
            }
        } else {
            // Sin Referer check... Intentar Contexto Global
            if let Ok(guard) = LAST_EXTERNAL_TARGET.lock() {
                if let Some(ctx) = &*guard {
                    if is_app_proxy_required(app_handle, &ctx.app_id) {
                        should_proxy = true;
                        // println!("🔗 [Proxy] Recovered App ID from context: {}", ctx.app_id);
                    }
                }
            }
            if !should_proxy {
                println!("⚠️ [Proxy] Request to /v1 without Referer and No Context match. Skipping Proxy.");
            }
        }

        if should_proxy {
            if let Some(active_conn) = get_active_connection(app_handle) {
                match proxy_to_remote(active_conn, request) {
                    Ok(response) => return response,
                    Err(e) => {
                        println!("❌ Error en Proxy Remoto: {}", e);
                        // Si falla el proxy pero era requerido, devolvemos error 502 explícito
                        return create_error_response(
                            502,
                            format!("Proxy Error (Remote Unreachable): {}", e).as_str(),
                        );
                    }
                }
            } else {
                println!("⚠️ [Proxy] App requires proxy but NO active connection found.");
                // Fallback: Dejar pasar a local (o 404), o retornar error específico?
                // Usuario dijo: "Evalua cuidosamente que siempre que este activo el proxy pero no hay una conexion activa entonces seguir su flujo normal."
                // "Flujo normal" podría ser intentar local, o simplemente fallar.
                // Seguiré al bloque 3 (serve_local_file) que probablemente dará 404 si no existe local.
            }
        }
    }

    // 3. TODO LO DEMÁS -> LOCAL (UI, Assets, Scripts)
    // Cualquier cosa que no sea /v1/ se asume parte del Frontend Local.
    serve_local_file(app_handle, path)
}

fn get_active_connection(app_handle: &AppHandle) -> Option<Connection> {
    let state = app_handle.state::<DbState>();
    let conn_guard = state.0.lock().ok()?; // Handle lock error gracefully

    let result = conn_guard.query_row(
        "SELECT id, name, ip_address, port, username, password, last_connected, wss_host, wss_port, is_connected FROM connections WHERE is_connected = 1",
        [],
        |row| {
             let is_connected_val: Option<i32> = row.get(9).ok();
             let is_connected = matches!(is_connected_val, Some(1));
             // println!("DB Check: {} (is_connected: {})", row.get::<_, String>(1).unwrap_or_default(), is_connected);
             Ok(Connection {
                id: Some(row.get(0)?),
                name: row.get(1)?,
                ip_address: row.get(2)?,
                port: row.get(3)?,
                username: row.get(4)?,
                password: row.get(5)?,
                last_connected: row.get(6)?,
                wss_host: row.get(7).ok(),
                wss_port: row.get(8).ok(),
                is_connected: Some(is_connected),
            })
        }
    ).optional().unwrap_or(None);

    if let Some(ref conn) = result {
        println!(
            "✅ [Proxy] Active Connection Found: {} ({}:{})",
            conn.name, conn.ip_address, conn.port
        );
    } else {
        println!("🚫 [Proxy] No Active Connection found in DB.");
    }

    result
}

fn is_app_proxy_required(app_handle: &AppHandle, app_id: &str) -> bool {
    // Si app_id es inválido, retorna false
    if app_id.is_empty() {
        return false;
    }

    let state = app_handle.state::<DbState>();
    let conn_res = state.0.lock();
    if conn_res.is_err() {
        eprintln!("❌ [Proxy Check] Failed to lock DB mutex");
        return false;
    }
    let conn = conn_res.unwrap();

    let query = "SELECT is_proxy_required FROM desktop_apps WHERE app_id = ?1";
    let required: bool = conn
        .query_row(query, [app_id], |row| row.get(0))
        .unwrap_or(false);

    // DEBUG
    // println!("🔍 [Proxy Check] App: '{}', Required: {}", app_id, required);
    required
}

fn serve_local_file(app_handle: &AppHandle, path: &str) -> Response<Vec<u8>> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .expect("Error al obtener AppData");

    let clean_path = path.trim_start_matches('/');

    // CASO 1: Raíz de una APP (ej: "gdoc/")
    // Si el path termina en slash, asumimos que es el índice de la App.
    // La estructura esperada es apps/<app_id>/dist/index.html
    let file_path = if path.ends_with('/') {
        let app_id = clean_path.trim_end_matches('/'); // "gdoc"
        app_dir
            .join("apps")
            .join(app_id)
            .join("dist")
            .join("index.html")
    }
    // CASO 2: Recurso específico (ej: "gdoc/styles.css" o "gdoc/assets/logo.png")
    else {
        let parts: Vec<&str> = clean_path.splitn(2, '/').collect();
        // Si tenemos [app_id, asset_path]
        if parts.len() == 2 {
            let app_id = parts[0];
            let asset_path = parts[1]; // puede ser "styles.css" o "assets/logo.png" o "index.html" si alguien lo pide explícito
            app_dir
                .join("apps")
                .join(app_id)
                .join("dist")
                .join(asset_path)
        } else {
            // Fallback genérico si no encaja en estructura app/asset
            app_dir.join("apps").join(clean_path)
        }
    };

    // Debugging path resolution
    // println!("📂 [Local] Resolving: {} -> {:?}", path, file_path);

    if !file_path.exists() {
        // println!("⚠️ [Local] File NOT found: {:?}", file_path);

        // FALLBACK SPA: Si el archivo no existe, pero parece ser una ruta de navegación (sin extensión),
        // intentamos servir el index.html de la aplicación correspondiente.
        if std::path::Path::new(path).extension().is_none() {
            let clean_path = path.trim_start_matches('/');
            let parts: Vec<&str> = clean_path.splitn(2, '/').collect();
            if !parts.is_empty() {
                let app_id = parts[0];
                // Intentamos buscar apps/<app_id>/dist/index.html
                let index_path = app_dir
                    .join("apps")
                    .join(app_id)
                    .join("dist")
                    .join("index.html");

                if index_path.exists() {
                    // println!("🔄 [SPA Fallback] Serving index.html for route: {}", path);
                    match fs::read(&index_path) {
                        Ok(content) => {
                            return Response::builder()
                                .header(CONTENT_TYPE, "text/html")
                                .header("Access-Control-Allow-Origin", "*")
                                .body(content)
                                .unwrap_or_else(|_| {
                                    create_error_response(500, "Error building response")
                                });
                        }
                        Err(_) => {} // Fall through to 404
                    }
                }
            }
        }

        if let Ok(guard) = LAST_EXTERNAL_TARGET.lock() {
            if let Some(ctx) = &*guard {
                let target_url = &ctx.target_url;
                println!(
                    "🚀 [Local Fallback] Attempting external proxy via stored context: {}",
                    target_url
                );
                if let Ok(base_url) = Url::parse(target_url) {
                    if let Ok(full_url) = base_url.join(path.trim_start_matches('/')) {
                        let full_url_str = full_url.to_string();
                        // println!("🚀 [Local Fallback] Attempting: {}", full_url_str);
                        match proxy_arbitrary_url(&full_url_str, None) {
                            Ok(resp) => return resp,
                            Err(e) => {
                                println!(
                                    "⚠️ [Local Fallback] Failed remote fetch to {}: {}",
                                    full_url_str, e
                                );
                                // Continue to 404 local? Or return 502?
                                // Let's return local 404 for now as fallback chain suggests.
                            }
                        }
                    }
                }
            }
        }

        return create_error_response(
            404,
            format!("Local file not found: {:?}", file_path).as_str(),
        );
    }

    match fs::read(&file_path) {
        Ok(content) => {
            let extension = file_path.extension().and_then(|s| s.to_str()).unwrap_or("");

            // ... (rest of logic) ...

            let mime_type = match extension {
                "html" => "text/html",
                "js" => "application/javascript",
                "css" => "text/css",
                "svg" => "image/svg+xml",
                "png" => "image/png",
                "json" => "application/json",
                // Google Fonts WOFF2 fix
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

fn proxy_to_remote(
    conn: Connection,
    request: &Request<Vec<u8>>,
) -> Result<Response<Vec<u8>>, Box<dyn std::error::Error>> {
    let remote_ip = conn.ip_address;
    let remote_port = conn.port;
    let path = request.uri().path();
    let query = request.uri().query();

    // Construir URL remota preservando query params
    let remote_url = if let Some(q) = query {
        format!("https://{}:{}{}?{}", remote_ip, remote_port, path, q)
    } else {
        format!("https://{}:{}{}", remote_ip, remote_port, path)
    };
    println!("🚀 [Proxy] Forwarding to: {}", remote_url);

    let method = request.method().clone();

    // Preparar cliente con timeout y sin cert check (entorno desarrollo/interno)
    let client = reqwest::blocking::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(15))
        .build()?;

    let mut req_builder = client.request(method, &remote_url);

    // Forward Headers (Critical: Authorization, Content-Type)
    if let Some(ct) = request.headers().get("content-type") {
        req_builder = req_builder.header("Content-Type", ct);
    }
    if let Some(auth) = request.headers().get("authorization") {
        req_builder = req_builder.header("Authorization", auth);
    }

    // Forward Body
    let body_bytes = request.body().clone();
    if !body_bytes.is_empty() {
        req_builder = req_builder.body(body_bytes);
    }

    // Ejecutar petición
    let resp = req_builder.send()?;

    // Procesar respuesta
    // Procesar respuesta
    let status = resp.status();
    let headers = resp.headers().clone();
    let body = resp.bytes()?.to_vec();

    // 1. Iniciar el builder con el status original
    let mut response_builder = Response::builder().status(status.as_u16());

    // 2. Copiar headers REMOTOS pero FILTRAR los problemáticos para iframes y compresión
    for (name, value) in headers.iter() {
        let name_str = name.as_str().to_lowercase();
        // Omitimos headers problemáticos
        if name_str != "x-frame-options"
            && name_str != "content-security-policy"
            && name_str != "access-control-allow-origin"
            && name_str != "content-encoding"
            && name_str != "content-length"
            && name_str != "transfer-encoding"
        {
            response_builder = response_builder.header(name, value);
        }
    }

    // 3. Inyectar nuestros headers permisivos ("Engaño" al navegador)
    Ok(response_builder
        .header("Access-Control-Allow-Origin", "*")
        .header("X-Frame-Options", "ALLOWALL")
        .header("Referrer-Policy", "unsafe-url") // 🚀 IMPORTANTE: Forzar al navegador a enviar el Referer completo siempre
        .header(
            "Content-Security-Policy",
            "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;",
        ) // Muy permisivo para sandbox
        .body(body)?)
}

fn create_response(status: u16, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, content_type)
        .header("Access-Control-Allow-Origin", "*")
        .body(body)
        .unwrap()
}

fn create_error_response(status: u16, msg: &str) -> Response<Vec<u8>> {
    create_response(status, "text/plain", msg.to_string().into_bytes())
}

fn proxy_arbitrary_url(
    remote_url: &str,
    base_href: Option<String>,
) -> Result<Response<Vec<u8>>, Box<dyn std::error::Error>> {
    // println!("🌍 [External Proxy] Fetching: {}", remote_url);

    // Preparar cliente con timeout
    let client = reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36") // Spoof User Agent
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(20))
        .build()?;

    // Realizamos petición GET simple por defecto (o podríamos intentar pasar métodos)
    let resp = client.get(remote_url).send()?;

    // Procesar respuesta
    let status = resp.status();
    println!(
        "✅ [External Proxy] Response: {} status {}",
        remote_url, status
    );

    let headers = resp.headers().clone();
    let mut body = resp.bytes()?.to_vec();

    // Hot-Patch para Angular/Webpack Dev Server en sandra-app://
    // Inyectamos un script que intercepta new WebSocket() para evitar crash por URL inválida
    let content_type = headers
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if content_type.contains("text/html") {
        if let Ok(mut body_str) = String::from_utf8(body.clone()) {
            // 1. INJECT BASE HREF (If requested)
            if let Some(href_val) = base_href {
                // Try reasonable variations of base tag
                if body_str.contains("<base href=\"/\">") {
                    body_str = body_str.replace(
                        "<base href=\"/\">",
                        &format!("<base href=\"{}\">", href_val),
                    );
                    println!("🔧 [Proxy] Patched <base href> to {}", href_val);
                } else if body_str.contains("<base href=\"./\">") {
                    body_str = body_str.replace(
                        "<base href=\"./\">",
                        &format!("<base href=\"{}\">", href_val),
                    );
                    println!("🔧 [Proxy] Patched <base href> ./ to {}", href_val);
                } else if !body_str.contains("<base ") {
                    // Inject head if no base exists
                    // Very crude injection, but covers 99% of generated index.html
                    body_str =
                        body_str.replace("<head>", &format!("<head><base href=\"{}\">", href_val));
                    println!("🔧 [Proxy] Injected new <base href> {}", href_val);
                }
            }

            // 2. INJECT WEBSOCKET PATCH
            let script = r#"
<script>
(function(){
  // SDC Patch: Prevent WebSocket crash on sandra-app:// schema
  var StdWS = window.WebSocket;
  window.WebSocket = function(url, proto){
    try {
        var u = url ? url.toString() : "";
        if(u.indexOf('sandra-app:') >= 0) {
            console.warn('[SDC] Patch: Blocking invalid WebSocket URL:', u);
            return { 
                close: function(){}, 
                send: function(){}, 
                addEventListener: function(e,cb){}, 
                removeEventListener: function(e,cb){},
                readyState: 3 
            };
        }
        return new StdWS(url, proto);
    } catch(e) {
        console.error('[SDC] WS Error:', e);
        return new StdWS(url, proto);
    }
  };
  ["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach(k => window.WebSocket[k] = StdWS[k]);
})();
</script>
"#;
            // PRECISE INJECTION: Find <head> or <HEAD>, possibly with attributes
            let lower = body_str.to_lowercase();
            if let Some(head_start) = lower.find("<head") {
                if let Some(relative_end) = body_str[head_start..].find('>') {
                    let insert_pos = head_start + relative_end + 1;
                    body_str.insert_str(insert_pos, script);
                } else {
                    body_str = format!("{}{}", script, body_str);
                }
            } else {
                body_str = format!("{}{}", script, body_str);
            }
            body = body_str.into_bytes();
        }
    }

    // === JS SOURCE REWRITING (Robust) ===
    let url_lower = remote_url.to_lowercase();
    let is_js = content_type.contains("javascript")
        || content_type.contains("application/x-javascript")
        || url_lower.ends_with(".js")
        || url_lower.contains(".js?");

    if is_js {
        if let Ok(js_str) = String::from_utf8(body.clone()) {
            let mut modified = false;
            let mut new_js = js_str;

            // Rewrite 'new WebSocket(' - Include parenthesis to avoid matching WebSocketSubject
            if new_js.contains("new WebSocket(") {
                new_js = new_js.replace(
                    "new WebSocket(",
                    "new (window.__SDC_SAFE_WS || window.WebSocket)(",
                );
                modified = true;
            }
            // Rewrite 'new window.WebSocket('
            if new_js.contains("new window.WebSocket(") {
                new_js = new_js.replace(
                    "new window.WebSocket(",
                    "new (window.__SDC_SAFE_WS || window.WebSocket)(",
                );
                modified = true;
            }

            // Rewrite SockJS Protocol & URL Checks (Aggressive)
            // 1. "The URL's scheme must be either 'http:' or 'https:'"
            let sockjs_scheme_err = "The URL's scheme must be either";
            if new_js.contains(sockjs_scheme_err) {
                println!(
                    "💉 [Proxy] Suppressing SockJS Scheme Check in: {}",
                    remote_url
                );
                new_js = new_js.replace(
                    "throw new SyntaxError(\"The URL's scheme",
                    "console.warn(\"SDC Suppressed: The URL's scheme",
                );
                new_js = new_js.replace(
                    "throw new SyntaxError('The URL\\'s scheme",
                    "console.warn('SDC Suppressed: The URL\\'s scheme",
                );
                modified = true;
            }

            // 2. "The URL '...' is invalid"
            let sockjs_invalid_err = "is invalid\")";
            if new_js.contains(sockjs_invalid_err) || new_js.contains("is invalid')") {
                println!(
                    "💉 [Proxy] Suppressing SockJS Invalid URL Check in: {}",
                    remote_url
                );
                new_js = new_js.replace(
                    "throw new SyntaxError(\"The URL '\"",
                    "console.warn(\"SDC Suppressed: The URL '\"",
                );
                new_js = new_js.replace(
                    "throw new SyntaxError('The URL \\''",
                    "console.warn('SDC Suppressed: The URL \\''",
                );
                modified = true;
            }

            // 3. SecurityError
            if new_js.contains("SecurityError: An insecure SockJS connection") {
                new_js = new_js.replace(
                    "throw new Error(\"SecurityError:",
                    "console.warn(\"SDC Suppressed: SecurityError:",
                );
                new_js = new_js.replace(
                    "throw new Error('SecurityError:",
                    "console.warn('SDC Suppressed: SecurityError:",
                );
                modified = true;
            }

            if modified {
                println!("💉 [Proxy] Rewrote Source Code in: {}", remote_url);
                body = new_js.into_bytes();
            }
        }
    }

    // 1. Iniciar el builder con el status original
    let mut response_builder = Response::builder().status(status.as_u16());

    // 2. Copiar headers REMOTOS pero FILTRAR los problemáticos para iframes y compresión
    for (name, value) in headers.iter() {
        let name_str = name.as_str().to_lowercase();
        // Omitimos headers problemáticos
        if name_str != "x-frame-options"
            && name_str != "content-security-policy"
            && name_str != "access-control-allow-origin"
            && name_str != "access-control-allow-credentials"
            && name_str != "content-encoding"
            && name_str != "content-length"
            && name_str != "transfer-encoding"
        {
            response_builder = response_builder.header(name, value);
        }
    }

    // 3. Inyectar nuestros headers permisivos ("Engaño" al navegador)
    Ok(response_builder
        .header("Access-Control-Allow-Origin", "*") // Ojo: con credentials true, esto no puede ser '*' en browsers estrictos, pero en Tauri custom protocol a veces cuela. Si falla, hay que reflejar el Origin.
        .header("Access-Control-Allow-Credentials", "true")
        .header(
            "Access-Control-Allow-Methods",
            "GET, POST, OPTIONS, PUT, DELETE",
        )
        .header(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization, X-Requested-With",
        )
        .header("X-Frame-Options", "ALLOWALL")
        .header("Referrer-Policy", "unsafe-url")
        .header(
            "Content-Security-Policy",
            "default-src * 'unsafe-inline' 'unsafe-eval' data: blob: sandra-app:;", // sandra-app: añadido
        )
        .body(body)?)
}
