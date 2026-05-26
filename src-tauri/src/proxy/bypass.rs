use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::http::{header::CONTENT_TYPE, Response};
use tauri::AppHandle;

use super::auditor::{emit_network_log, NetworkEventDetails, NetworkEventPayload};

static BYPASS_CLIENTS: OnceLock<Mutex<HashMap<String, reqwest::blocking::Client>>> =
    OnceLock::new();

fn get_client(app_id: &str) -> Result<reqwest::blocking::Client, Box<dyn std::error::Error>> {
    let map = BYPASS_CLIENTS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = map.lock().unwrap();

    if let Some(c) = guard.get(app_id) {
        return Ok(c.clone());
    }

    let client = reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .danger_accept_invalid_certs(true)
        .cookie_store(true)
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    guard.insert(app_id.to_string(), client.clone());
    Ok(client)
}

pub fn proxy_bypass_url(
    app_handle: &AppHandle,
    app_id: &str,
    remote_url: &str,
    request: &tauri::http::Request<Vec<u8>>,
) -> Result<Response<Vec<u8>>, Box<dyn std::error::Error>> {
    let scheme = request.uri().scheme_str().unwrap_or("sandra-app");
    let host = request.uri().host().unwrap_or("localhost");
    let base_url_prefix = if let Some(port) = request.uri().port() {
        format!("{}://{}:{}", scheme, host, port)
    } else {
        format!("{}://{}", scheme, host)
    };

    let client = get_client(app_id)?;

    let method = request.method().clone();
    let mut req = client.request(method.clone(), remote_url);

    // Verificar si es una petición fetch interceptada por nosotros
    let is_sdc_fetch = request.headers().get("x-sdc-fetch").is_some();

    // PASAR TODOS LOS HEADERS EXACTAMENTE COMO VIENEN
    let mut audit = HashMap::new();
    for (name, val) in request.headers().iter() {
        let name_str = name.as_str().to_lowercase();

        // Lista blanca de headers permitidos
        let allowed = [
            "accept",
            "accept-encoding",
            "accept-language",
            "cache-control",
            "connection",
            "content-length",
            "content-type",
            "origin",
            "pragma",
            "priority",
            "upgrade-insecure-requests",
            "user-agent",
            "x-requested-with",
        ];

        // NO pasar headers que manejamos manualmente o que reqwest debe manejar
        let blacklisted = [
            "origin",
            "referer",
            "host",
            "cookie",
            "content-length",
            "connection",
            "accept-encoding",
        ];

        if allowed.contains(&name_str.as_str()) && !blacklisted.contains(&name_str.as_str()) {
            req = req.header(name, val);
            if let Ok(v) = val.to_str() {
                audit.insert(name.as_str().to_string(), v.to_string());
            }
        }
    }

    // Configurar Origin y Referer para evitar bloqueos por seguridad (CSRF)
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
        req = req.header("Origin", origin);

        // Si el request original traía un Referer, intentamos mapearlo al remoto
        if let Some(orig_referer) = request
            .headers()
            .get("referer")
            .and_then(|v| v.to_str().ok())
        {
            if orig_referer.contains("/bypass-proxy/") {
                // El referer real debería ser el mismo remote_url pero tal vez del paso anterior.
                // Como simplificación, usamos el origen o intentamos reconstruirlo.
                req = req.header("Referer", remote_url);
            }
        } else {
            req = req.header("Referer", remote_url);
        }
    }

    // Body exacto
    let body = request.body().clone();
    if !body.is_empty() {
        req = req.body(body);
    }

    println!(
        "📡 [Bypass] Request: {} {} (Fetch: {})",
        method, remote_url, is_sdc_fetch
    );
    let resp = req.send()?;
    let status = resp.status();
    println!("🚧 [Bypass] {} -> {}", remote_url, status.as_u16());

    let headers = resp.headers().clone();
    let mut body_bytes = resp.bytes()?.to_vec();

    // Inyectar script para interceptar TODO el tráfico
    if headers
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|c| c.contains("text/html"))
        .unwrap_or(false)
    {
        if let Ok(html) = String::from_utf8(body_bytes.clone()) {
            // REESCRITURA QUIRÚRGICA EXCLUSIVA PARA EL SISTEMA PACE:
            // Esto garantiza un 100% de aislamiento para no afectar ninguna otra app existente.
            let is_pace = remote_url.to_lowercase().contains("/pace");
            let html_processed = if is_pace {
                let proxy_prefix = format!("{}/bypass-proxy/{}/", base_url_prefix, app_id);
                println!("🔄 [Bypass-PACE] Reescribiendo enlaces duros a ruta de proxy: {}", proxy_prefix);
                let mut temp = html.replace("http://localhost/pace/", &proxy_prefix);
                temp = temp.replace("http://localhost/pace", &proxy_prefix.trim_end_matches('/'));
                
                // Reemplazar enlaces absolutos del servidor de producción PACE
                temp = temp.replace("http://pace.ipsfa.gob.ve:8080/pace/", &proxy_prefix);
                temp = temp.replace("http://pace.ipsfa.gob.ve:8080/pace", &proxy_prefix.trim_end_matches('/'));
                temp = temp.replace("http://pace.ipsfa.gob.ve/pace/", &proxy_prefix);
                temp = temp.replace("http://pace.ipsfa.gob.ve/pace", &proxy_prefix.trim_end_matches('/'));
                temp = temp.replace("https://pace.ipsfa.gob.ve/pace/", &proxy_prefix);
                temp = temp.replace("https://pace.ipsfa.gob.ve/pace", &proxy_prefix.trim_end_matches('/'));
                temp
            } else {
                html
            };

            // Calcular el server_base correctamente - debe incluir /backend/web
            let server_base = if let Some(idx) = remote_url.find("/backend/web") {
                &remote_url[..idx + "/backend/web".len()]
            } else if let Some(idx) = remote_url.find("/in_farmacia/") {
                &remote_url[..idx + "/in_farmacia".len()]
            } else {
                remote_url.trim_end_matches('/')
            };

            let script = format!(
                r##"<script>
(function(){{
    const SERVER_ORIGIN = "{}";
    let baseOrigin = window.location.origin;
    if (!baseOrigin || baseOrigin === "null" || baseOrigin === "opaque") {{
        baseOrigin = "{}";
    }}
    const PROXY_PATH = baseOrigin.endsWith('/') ? baseOrigin + "bypass-proxy/{}" : baseOrigin + "/bypass-proxy/{}";
    
    // Función para reescribir URLs
    function rewriteUrl(url) {{
        if (!url || typeof url !== 'string') return url;
        
        // Si ya es una URL de sandra-app o está reescrita, no la tocamos
        if (url.startsWith('sandra-app://') || url.startsWith('http://sandra-app.localhost') || url.startsWith('https://sandra-app.localhost') || url.startsWith(PROXY_PATH)) return url;

        // Si es URL completa del servidor
        if (url.startsWith(SERVER_ORIGIN)) {{
            var path = url.substring(SERVER_ORIGIN.length);
            return PROXY_PATH + (path.startsWith('/') ? path : '/' + path);
        }}
        
        // Si es path absoluto que empieza con /in_farmacia/
        if (url.startsWith('/in_farmacia/')) {{
            return PROXY_PATH + url;
        }}
        
        // Si es path absoluto que empieza con /backend/ o /assets/
        if (url.startsWith('/backend/') || url.startsWith('/assets/')) {{
            return PROXY_PATH + '/in_farmacia' + url;
        }}
        
        // Si es una URL relativa (no empieza con / ni http)
        if (!url.startsWith('/') && !url.startsWith('http') && !url.startsWith('sandra-app:')) {{
             // Si estamos en una sub-ruta del proxy, la URL relativa debería mantenerse en el proxy
             // El navegador la resolverá automáticamente contra la URL actual que YA es del proxy.
             // Ejemplo: si estamos en .../site/login y la url es "captcha", el browser pide .../site/captcha
             // console.log('[Bypass] Relative URL kept as is:', url);
        }}

        return url;
    }}
    
    // Interceptar fetch
    const origFetch = window.fetch;
    window.fetch = function(url, options) {{
        const newUrl = rewriteUrl(url);
        if (newUrl !== url) console.log('[Bypass] fetch:', url, '->', newUrl);
        return origFetch.call(this, newUrl, options);
    }};
    
    // Interceptar XHR
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, async, user, password) {{
        const newUrl = rewriteUrl(url);
        if (newUrl !== url) console.log('[Bypass] XHR:', url, '->', newUrl);
        return origOpen.call(this, method, newUrl, async, user, password);
    }};
    
    // Interceptar form submits
    document.addEventListener('submit', function(e) {{
        e.preventDefault();
        const form = e.target;
        if (form.tagName === 'FORM') {{
            const action = form.getAttribute('action') || form.action || window.location.href;
            const newAction = rewriteUrl(action);
            console.log('[Bypass] Intercepted Form:', action, '->', newAction);
            
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
                    'X-SDC-Fetch': '1'
                }}
            }}).then(async response => {{
                console.log('[Bypass] Form response status:', response.status);
                const text = await response.text();
                if (text) {{
                    // Escribir el HTML resultante directamente (reqwest ya siguió el redirect internamente)
                    document.open();
                    document.write(text);
                    document.close();
                    console.log('[Bypass] Document updated from form response');
                }} else {{
                    console.warn('[Bypass] Empty response from form submission');
                }}
            }}).catch(err => console.error('[Bypass] Form submit error:', err));
        }}
    }}, true);
    
    // Interceptar clicks en links
    document.addEventListener('click', function(e) {{
        const link = e.target.closest('a');
        if (link && link.href) {{
            const newHref = rewriteUrl(link.href);
            if (newHref !== link.href) {{
                console.log('[Bypass] Link:', link.href, '->', newHref);
                link.href = newHref;
            }}
        }}
    }}, true);
    
    // Interceptar cambios en atributos
    const origSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {{
        if (name === 'src' || name === 'href' || name === 'action') {{
            value = rewriteUrl(value);
        }}
        return origSetAttribute.call(this, name, value);
    }};
    
    // Agregar base tag al inicio del head (crítico para assets)
    const baseHref = PROXY_PATH.endsWith('/') ? PROXY_PATH : PROXY_PATH + '/';
    const existingBase = document.querySelector('base');
    if (existingBase) {{
        existingBase.href = baseHref;
    }} else {{
        const base = document.createElement('base');
        base.href = baseHref;
        document.head.insertBefore(base, document.head.firstChild);
    }}
}})();
</script>"##,
                server_base, base_url_prefix, app_id, app_id
            );

            // Insertar script al INICIO del head (para ejecutarse antes que los assets)
            let new_html = if html_processed.contains("<head>") {
                html_processed.replace("<head>", &format!("<head>{}", script))
            } else if html_processed.contains("<html>") {
                html_processed.replace("<html>", &format!("<html><head>{}</head>", script))
            } else {
                script.clone() + &html_processed
            };

            body_bytes = new_html.into_bytes();
            println!("  📥 Script inyectado en <head>");
        }
    }

    // Auditoría
    let body_preview = String::from_utf8(body_bytes.clone())
        .map(|s| {
            if s.len() > 500 {
                s[..500].to_string() + "..."
            } else {
                s
            }
        })
        .unwrap_or_default();

    emit_network_log(
        app_handle,
        NetworkEventPayload {
            app_id: app_id.to_string(),
            log_type: if status.is_success() {
                "FETCH"
            } else {
                "ERROR"
            }
            .to_string(),
            message: format!("{} [{}]", remote_url, status.as_u16()),
            details: NetworkEventDetails {
                url: remote_url.to_string(),
                method: method.to_string(),
                status: status.as_u16(),
                request_headers: audit,
                response_body: body_preview,
                source: "Bypass".to_string(),
            },
        },
    );

    // Respuesta
    let mut rb = Response::builder().status(status.as_u16());
    for (n, v) in headers.iter() {
        let n_str = n.as_str().to_lowercase();
        // ESTO ES CLAVE: No enviamos Set-Cookie al frontend. Rust se queda con las cookies.
        if n_str != "set-cookie" && n_str != "content-security-policy" && n_str != "x-frame-options"
        {
            // Fix: Reescribir Location para que el WebView siga en el proxy
            if n_str == "location" {
                if let Ok(loc_str) = v.to_str() {
                    let new_loc = if loc_str.starts_with('/') {
                        format!("{}/bypass-proxy/{}{}", base_url_prefix, app_id, loc_str)
                    } else if loc_str.starts_with("http") {
                        let target = urlencoding::encode(loc_str);
                        format!(
                            "{}/bypass-proxy/{}/?target={}",
                            base_url_prefix, app_id, target
                        )
                    } else {
                        loc_str.to_string()
                    };
                    rb = rb.header("Location", new_loc);
                    continue;
                }
            }
            rb = rb.header(n, v);
        }
    }

    Ok(rb
        .header("Access-Control-Allow-Origin", "*")
        .header("X-Frame-Options", "ALLOWALL")
        .body(body_bytes)?)
}
