use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::http::{header::CONTENT_TYPE, Response};
use tauri::AppHandle;

use super::auditor::{emit_network_log, NetworkEventDetails, NetworkEventPayload};
use super::utils::create_response;

// Mantiene un cliente HTTP persistente (con Cookie Jar) por cada App ID.
// Rust 1.70+ permite OnceLock.
static LIMITLESS_CLIENTS: OnceLock<Mutex<HashMap<String, reqwest::blocking::Client>>> =
    OnceLock::new();

fn get_or_create_client(
    app_id: &str,
) -> Result<reqwest::blocking::Client, Box<dyn std::error::Error>> {
    let clients_map = LIMITLESS_CLIENTS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut map = clients_map.lock().unwrap();

    if let Some(client) = map.get(app_id) {
        return Ok(client.clone());
    }

    let client = reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .danger_accept_invalid_certs(true)
        .cookie_store(true) // <--- MAGIA: Mantiene PHPSESSID, _csrf, etc. internamente
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    map.insert(app_id.to_string(), client.clone());
    Ok(client)
}

pub fn proxy_limitless_url(
    app_handle: &AppHandle,
    app_id: &str,
    remote_url: &str,
    base_href: Option<String>,
    request: &tauri::http::Request<Vec<u8>>,
) -> Result<Response<Vec<u8>>, Box<dyn std::error::Error>> {
    let client = get_or_create_client(app_id)?;

    if remote_url.contains("sockjs-node")
        || remote_url.contains("ng-cli-ws")
        || remote_url.contains("/info?t=")
    {
        return Ok(create_response(
            200,
            "application/json",
            r#"{"websocket":true,"origins":["*:*"],"cookie_needed":false,"entropy":1234567890}"#
                .as_bytes()
                .to_vec(),
        ));
    }

    let method = request.method().clone();
    let mut req_builder = client.request(method.clone(), remote_url);

    // Mapear headers del request original al proxy, excluyendo Host y Cookie
    // Verificar si es una petición fetch interceptada por nosotros
    let is_sdc_fetch = request.headers().get("x-sdc-fetch").is_some();

    let mut audit_request_headers = HashMap::new();
    for (name, value) in request.headers().iter() {
        let name_str = name.as_str().to_lowercase();
        // NO propagamos Cookie porque reqwest lo maneja internamente con cookie_store(true)
        if name_str != "host"
            && name_str != "cookie"
            && name_str != "origin"
            && name_str != "referer"
            && name_str != "content-length"
            && name_str != "connection"
            && name_str != "accept-encoding"
            && !name_str.starts_with(':')
        {
            req_builder = req_builder.header(name, value);
            if let Ok(v) = value.to_str() {
                audit_request_headers.insert(name.as_str().to_string(), v.to_string());
            }
        }
    }

    // Configurar Origin para evitar bloqueos CORS en el destino
    if let Ok(parsed_url) = url::Url::parse(remote_url) {
        let origin = format!(
            "{}://{}{}",
            parsed_url.scheme(),
            parsed_url.host_str().unwrap_or(""),
            if let Some(port) = parsed_url.port() {
                format!(":{}", port)
            } else {
                "".to_string()
            }
        );
        req_builder = req_builder.header("Origin", origin);

        // Referer mapping
        if let Some(orig_referer) = request
            .headers()
            .get("referer")
            .and_then(|v| v.to_str().ok())
        {
            if orig_referer.contains("/limitless-proxy/") {
                req_builder = req_builder.header("Referer", remote_url);
            }
        } else {
            req_builder = req_builder.header("Referer", remote_url);
        }
    }

    let body_bytes = request.body().clone();
    if !body_bytes.is_empty() {
        req_builder = req_builder.body(body_bytes);
    }

    let resp = req_builder.send()?;
    let status = resp.status();
    println!(
        "🚀 [Limitless Proxy] {} {} -> {}",
        method, remote_url, status
    );

    let headers = resp.headers().clone();
    let mut body = resp.bytes()?.to_vec();

    let content_type = headers
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    // Inyección HTML (Base Href + Monkey Patch de fetch/XHR)
    if content_type.contains("text/html") {
        if let Ok(mut body_str) = String::from_utf8(body.clone()) {
            if let Some(href_val) = base_href {
                if body_str.contains("<base href=\"/\">") {
                    body_str = body_str.replace(
                        "<base href=\"/\">",
                        &format!("<base href=\"{}\">", href_val),
                    );
                } else if body_str.contains("<base href=\"./\">") {
                    body_str = body_str.replace(
                        "<base href=\"./\">",
                        &format!("<base href=\"{}\">", href_val),
                    );
                } else if !body_str.contains("<base ") {
                    body_str =
                        body_str.replace("<head>", &format!("<head><base href=\"{}\">", href_val));
                }
            }

            let target_origin = if let Ok(parsed_url) = url::Url::parse(remote_url) {
                format!(
                    "{}://{}{}",
                    parsed_url.scheme(),
                    parsed_url.host_str().unwrap_or(""),
                    if let Some(port) = parsed_url.port() {
                        format!(":{}", port)
                    } else {
                        "".to_string()
                    }
                )
            } else {
                String::new()
            };

            // Inyectamos el interceptor de red
            let monkey_patch_script = format!(
                r#"
<script>
(function() {{
    // === SDC Limitless Network Interceptor ===
    const TARGET_ORIGIN = "{}";
    const APP_ID = "{}";
    const PROXY_PREFIX = "/limitless-proxy/" + APP_ID + "/";

    function rewriteUrl(url) {{
        if (!url) return url;
        let urlStr = url.toString();
        if (urlStr.startsWith(TARGET_ORIGIN)) {{
            let path = urlStr.substring(TARGET_ORIGIN.length);
            if (path.startsWith("/")) path = path.substring(1);
            return PROXY_PREFIX + path;
        }}
        return url;
    }}

    // Intercept Fetch
    const originalFetch = window.fetch;
    window.fetch = async function() {{
        let args = Array.from(arguments);
        if (args.length > 0) {{
            let originalUrl = args[0];
            args[0] = rewriteUrl(originalUrl);
            
            // Forzar credenciales para que las llamadas fluyan sin problemas si es necesario
            if (args.length > 1 && args[1] && typeof args[1] === 'object') {{
                if (args[1].credentials === 'omit') {{
                    args[1].credentials = 'same-origin';
                }}
            }} else if (args.length === 1 && typeof originalUrl === 'string') {{
                args.push({{ credentials: 'same-origin' }});
            }}
        }}
        return originalFetch.apply(this, args);
    }};

    // Intercept XHR
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function() {{
        let args = Array.from(arguments);
        if (args.length >= 2) {{
            args[1] = rewriteUrl(args[1]);
        }}
        return originalOpen.apply(this, args);
    }};

    // Interceptar form submits
    document.addEventListener('submit', function(e) {{
        e.preventDefault();
        const form = e.target;
        if (form.tagName === 'FORM') {{
            const action = form.getAttribute('action') || form.action || window.location.href;
            const newAction = rewriteUrl(action);
            
            const formData = new FormData(form);
            const params = new URLSearchParams();
            for (const pair of formData.entries()) {{
                params.append(pair[0], pair[1]);
            }}
            
            window.fetch(newAction, {{
                method: form.method ? form.method.toUpperCase() : 'POST',
                body: params,
                headers: {{
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-SDC-Fetch': '1' // Indicador para Rust
                }}
            }}).then(async response => {{
                const text = await response.text();
                document.open();
                document.write(text);
                document.close();
            }}).catch(err => console.error('[Limitless] Form submit error:', err));
        }}
    }}, true);
}})();
</script>
"#,
                target_origin, app_id
            );

            let lower = body_str.to_lowercase();
            if let Some(head_start) = lower.find("<head") {
                if let Some(relative_end) = body_str[head_start..].find('>') {
                    let insert_pos = head_start + relative_end + 1;
                    body_str.insert_str(insert_pos, &monkey_patch_script);
                } else {
                    body_str = format!("{}{}", monkey_patch_script, body_str);
                }
            } else {
                body_str = format!("{}{}", monkey_patch_script, body_str);
            }
            body = body_str.into_bytes();
        }
    }

    // AUDITORÍA
    let response_body_str = match String::from_utf8(body.clone()) {
        Ok(s) => {
            if s.len() > 5000 {
                format!("{}... (truncated)", &s[..5000])
            } else {
                s
            }
        }
        Err(_) => "[Binary Data]".to_string(),
    };

    let audit_payload = NetworkEventPayload {
        app_id: app_id.to_string(),
        log_type: if status.is_success() {
            "FETCH".to_string()
        } else {
            "ERROR".to_string()
        },
        message: format!("{} {} [{}]", method, remote_url, status.as_u16()),
        details: NetworkEventDetails {
            url: remote_url.to_string(),
            method: method.to_string(),
            status: status.as_u16(),
            request_headers: audit_request_headers,
            response_body: response_body_str,
            source: "Rust Limitless Proxy".to_string(),
        },
    };
    emit_network_log(app_handle, audit_payload);

    // Construir la respuesta hacia el WebView
    let mut response_builder = Response::builder().status(status.as_u16());
    for (name, value) in headers.iter() {
        let name_str = name.as_str().to_lowercase();
        // ESTO ES CLAVE: No enviamos Set-Cookie al frontend. Rust se queda con las cookies.
        if name_str != "set-cookie"
            && name_str != "x-frame-options"
            && name_str != "content-security-policy"
            && name_str != "access-control-allow-origin"
            && name_str != "content-encoding"
            && name_str != "content-length"
            && name_str != "transfer-encoding"
        {
            // Fix: Reescribir Location para que el WebView siga en el proxy
            if name_str == "location" {
                if let Ok(loc_str) = value.to_str() {
                    let new_loc = if loc_str.starts_with('/') {
                        format!(
                            "sandra-app://localhost/limitless-proxy/{}{}",
                            app_id, loc_str
                        )
                    } else if loc_str.starts_with("http") {
                        let target = urlencoding::encode(loc_str);
                        format!(
                            "sandra-app://localhost/limitless-proxy/{}/?target={}",
                            app_id, target
                        )
                    } else {
                        loc_str.to_string()
                    };
                    response_builder = response_builder.header("Location", new_loc);
                    continue;
                }
            }
            response_builder = response_builder.header(name, value);
        }
    }

    Ok(response_builder
        .header("Access-Control-Allow-Origin", "*")
        .header(
            "Access-Control-Allow-Methods",
            "GET, POST, OPTIONS, PUT, DELETE, PATCH",
        )
        .header("Access-Control-Allow-Headers", "*")
        .header("X-Frame-Options", "ALLOWALL")
        .header(
            "Content-Security-Policy",
            "default-src * 'unsafe-inline' 'unsafe-eval' data: blob: sandra-app:;",
        )
        .body(body)?)
}
