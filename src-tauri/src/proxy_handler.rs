use crate::commands::connections::Connection;
use crate::storage::DbState;
use rusqlite::OptionalExtension;
use std::fs;

use tauri::http::{header::CONTENT_TYPE, Request, Response};
use tauri::{AppHandle, Manager};
use url::Url;

// Extensiones que SIEMPRE deben servirse desde el sistema de archivos local
const STATIC_EXTENSIONS: &[&str] = &[
    "html", "htm", "js", "css", "png", "jpg", "jpeg", "svg", "gif", "ico", "woff", "woff2", "ttf",
    "eot", "map", "json",
];

// Global Context for "Sticky" External Sessions (Solves missing Referer in iframes)
use std::sync::Mutex;
static LAST_EXTERNAL_TARGET: Mutex<Option<String>> = Mutex::new(None);

pub fn handle_request(app_handle: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri = request.uri();
    let path = uri.path();

    // DEBUG: Ver qué llega realmente
    // println!(
    //     "🔍 Req: {} | Referer: {:?}",
    //     path,
    //     request.headers().get("referer")
    // );

    // 0. Caso Especial: Proxy para URLs Externas (Bypass X-Frame-Options)
    // Uso: sandra-app://localhost/external-proxy?target=https://google.com
    if path.starts_with("/external-proxy") {
        let query = uri.query().unwrap_or("");
        // Parsear "target=https://..." de forma muy básica o usar crates complejas.
        // Aquí haremos un split simple para no añadir dependencias extras.
        if let Some(target_url) = query.strip_prefix("target=") {
            let decoded_target =
                urlencoding::decode(target_url).unwrap_or(std::borrow::Cow::Borrowed(target_url));
            let target_str = decoded_target.to_string();

            // 🧠 SAVE CONTEXT: Guardamos esto como el último sitio externo visitado
            if let Ok(mut guard) = LAST_EXTERNAL_TARGET.lock() {
                *guard = Some(target_str.clone());
                // println!("🧠 [Context] Set External Target: {}", target_str);
            }

            match proxy_arbitrary_url(&decoded_target) {
                Ok(resp) => return resp,
                Err(e) => {
                    return create_error_response(
                        500,
                        format!("External Proxy Error: {}", e).as_str(),
                    )
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

                        match proxy_arbitrary_url(&full_url_str) {
                            Ok(resp) => return resp,
                            Err(e) => println!("⚠️ Failed to proxy via referer: {}", e),
                        }
                    }
                }
            }
        }
    }

    // 2. Discriminación de Tráfico Estático Local
    if is_static_resource(path) {
        return serve_local_file(app_handle, path);
    }

    // ... rest of filtering ...

    // 3. Fallback General: Si no hay referer y no es fichero estático local...

    // A) Intentar Contexto Externo (Sticky Session)
    // Si el usuario navegó antes a Google, asumimos que sigue ahí para peticiones dinámicas (ej: /search, /complete/search)
    if let Ok(guard) = LAST_EXTERNAL_TARGET.lock() {
        if let Some(target_url) = &*guard {
            // Solo si NO estamos en una petición de API interna explícita (opcional refinar)
            if let Ok(base_url) = Url::parse(target_url) {
                if let Ok(full_url) = base_url.join(path.trim_start_matches('/')) {
                    let full_url_str = full_url.to_string();
                    // println!(
                    //     "🚀 [Context Fallback Dynamic] Proxying dynamic req -> {}",
                    //     full_url_str
                    // );
                    if let Ok(resp) = proxy_arbitrary_url(&full_url_str) {
                        return resp;
                    }
                }
            }
        }
    }

    // B) Si NO hay contexto externo, intentamos usar el Proxy Remoto a la conexión activa (tunneling)
    if let Some(active_conn) = get_active_connection(app_handle) {
        match proxy_to_remote(active_conn, request) {
            Ok(response) => return response,
            Err(e) => {
                println!("❌ Error en Proxy Remoto: {}", e);
                return create_response(
                    502,
                    "text/plain",
                    format!("Bad Gateway: {}", e).into_bytes(),
                );
            }
        }
    }

    // 3. Fallback: Si no es estático pero no hay conexión activa,
    // intentamos servir localmente (por ejemplo, rutas de navegación SPA que no tienen extensión)
    // o devolvemos 404 si realmente se esperaba una API.
    serve_local_file(app_handle, path)
}

fn is_static_resource(path: &str) -> bool {
    // Si termina en slash, es una navegación a un directorio (index.html), por ende estático local.
    if path.ends_with('/') {
        return true;
    }

    if let Some(ext) = std::path::Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
    {
        STATIC_EXTENSIONS.contains(&ext.to_lowercase().as_str())
    } else {
        // Si no tiene extensión, asumimos que es dinámico (API) o ruta SPA.
        // Pero para efectos del Proxy Selectivo solicitado:
        // "Si es petición de datos... redirigirla". Las APIs suelen no tener extensión.
        false
    }
}

fn get_active_connection(app_handle: &AppHandle) -> Option<Connection> {
    let state = app_handle.state::<DbState>();
    let conn_guard = state.0.lock().ok()?; // Handle lock error gracefully

    conn_guard.query_row(
        "SELECT id, name, ip_address, port, username, password, last_connected, wss_host, wss_port, is_connected FROM connections WHERE is_connected = 1",
        [],
        |row| {
             let is_connected_val: Option<i32> = row.get(9).ok();
             let is_connected = matches!(is_connected_val, Some(1));
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
    ).optional().unwrap_or(None)
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

        // FALLBACK INTELIGENTE: Si no encontramos el archivo localmente,
        // y tenemos un contexto externo activo (porque el Referer falló o se perdió),
        // intentamos resolver contra ese sitio externo.
        if let Ok(guard) = LAST_EXTERNAL_TARGET.lock() {
            if let Some(target_url) = &*guard {
                if let Ok(base_url) = Url::parse(target_url) {
                    if let Ok(full_url) = base_url.join(path.trim_start_matches('/')) {
                        let full_url_str = full_url.to_string();
                        // println!(
                        //     "🚀 [Context Fallback] Proxying missing local file -> {}",
                        //     full_url_str
                        // );
                        if let Ok(resp) = proxy_arbitrary_url(&full_url_str) {
                            return resp;
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

    // Construir URL remota
    let remote_url = format!("https://{}:{}{}", remote_ip, remote_port, path);
    // println!("🚀 [Proxy] Forwarding to: {}", remote_url);

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

    // 2. Copiar headers REMOTOS pero FILTRAR los problemáticos para iframes
    for (name, value) in headers.iter() {
        let name_str = name.as_str().to_lowercase();
        // Omitimos estos headers para que NO bloqueen el iframe
        if name_str != "x-frame-options"
            && name_str != "content-security-policy"
            && name_str != "access-control-allow-origin"
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

fn proxy_arbitrary_url(remote_url: &str) -> Result<Response<Vec<u8>>, Box<dyn std::error::Error>> {
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
    let headers = resp.headers().clone();
    let body = resp.bytes()?.to_vec();

    // 1. Iniciar el builder con el status original
    let mut response_builder = Response::builder().status(status.as_u16());

    // 2. Copiar headers REMOTOS pero FILTRAR los problemáticos para iframes
    for (name, value) in headers.iter() {
        let name_str = name.as_str().to_lowercase();
        // Omitimos estos headers para que NO bloqueen el iframe
        if name_str != "x-frame-options"
            && name_str != "content-security-policy"
            && name_str != "access-control-allow-origin"
            && name_str != "access-control-allow-credentials"
        // Limpiar el original para inyectar el nuestro
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
