use std::collections::HashMap;
use tauri::http::{header::CONTENT_TYPE, Response};
use tauri::AppHandle;

use super::auditor::{emit_network_log, NetworkEventDetails, NetworkEventPayload};
use super::utils::create_response;

pub fn proxy_arbitrary_url(
    app_handle: &AppHandle,
    app_id_for_audit: &str,
    remote_url: &str,
    base_href: Option<String>,
) -> Result<Response<Vec<u8>>, Box<dyn std::error::Error>> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(20))
        .build()?;

    if remote_url.contains("sockjs-node") || remote_url.contains("ng-cli-ws") || remote_url.contains("/info?t=") {
        println!("🛑 [Proxy] Intercepted DevServer Info Request (fake 200): {}", remote_url);
        return Ok(create_response(
            200,
            "application/json",
            r#"{"websocket":true,"origins":["*:*"],"cookie_needed":false,"entropy":1234567890}"#.as_bytes().to_vec(),
        ));
    }

    let req_builder = client.get(remote_url);
    // Para simplificar, asumimos GET simple. Si se necesitan HEADERS, se pueden extraer del request original pasándolos.
    
    let resp = req_builder.send()?;
    let status = resp.status();
    println!("✅ [External Proxy] Response: {} status {}", remote_url, status);

    let headers = resp.headers().clone();
    let mut body = resp.bytes()?.to_vec();

    // AUDITORÍA
    let mut audit_headers = HashMap::new();
    for (name, value) in headers.iter() {
        if let Ok(v) = value.to_str() {
            audit_headers.insert(name.as_str().to_string(), v.to_string());
        }
    }
    
    let response_body_str = match String::from_utf8(body.clone()) {
        Ok(s) => if s.len() > 5000 { format!("{}... (truncated)", &s[..5000]) } else { s },
        Err(_) => "[Binary Data]".to_string(),
    };

    let audit_payload = NetworkEventPayload {
        app_id: app_id_for_audit.to_string(),
        log_type: if status.is_success() { "FETCH".to_string() } else { "ERROR".to_string() },
        message: format!("GET {} [{}]", remote_url, status.as_u16()),
        details: NetworkEventDetails {
            url: remote_url.to_string(),
            method: "GET".to_string(),
            status: status.as_u16(),
            request_headers: HashMap::new(), // GET genérico
            response_body: response_body_str,
            source: "Rust External Proxy".to_string(),
        },
    };
    emit_network_log(app_handle, audit_payload);

    let content_type = headers.get(CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("");

    if content_type.contains("text/html") {
        if let Ok(mut body_str) = String::from_utf8(body.clone()) {
            if let Some(href_val) = base_href {
                if body_str.contains("<base href=\"/\">") {
                    body_str = body_str.replace("<base href=\"/\">", &format!("<base href=\"{}\">", href_val));
                } else if body_str.contains("<base href=\"./\">") {
                    body_str = body_str.replace("<base href=\"./\">", &format!("<base href=\"{}\">", href_val));
                } else if body_str.contains("<base href='/'>") {
                    body_str = body_str.replace("<base href='/'>", &format!("<base href=\"{}\">", href_val));
                } else if body_str.contains("<base href='./'>") {
                    body_str = body_str.replace("<base href='./'>", &format!("<base href=\"{}\">", href_val));
                } else if !body_str.contains("<base ") {
                    body_str = body_str.replace("<head>", &format!("<head><base href=\"{}\">", href_val));
                }
            }

            let script = r#"
<script>
(function(){
  var StdWS = window.WebSocket;
  window.WebSocket = function(url, proto){
    try {
        var u = url ? url.toString() : "";
        if(u.indexOf('sandra-app:') === 0) {
             if (u.includes(':4200') || u.includes('/ng-cli-ws') || u.includes('/sockjs-node') || u.includes('/ws')) {
                u = u.replace(/^sandra-app:/, 'ws:');
             } else {
                return { close: function(){}, send: function(){}, addEventListener: function(){}, removeEventListener: function(){}, readyState: 3 };
             }
        }
        if (u.indexOf('//0.0.0.0') !== -1) u = u.replace('//0.0.0.0', '//localhost');
        if ((u.includes('ng-cli-ws') || u.includes('sockjs-node')) && !u.match(/:[0-9]+/)) u = u.replace('//localhost', '//localhost:4200');
        return new StdWS(u, proto);
    } catch(e) { return new StdWS(url, proto); }
  };
  ["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach(k => window.WebSocket[k] = StdWS[k]);
})();
</script>
"#;
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

    let url_lower = remote_url.to_lowercase();
    let is_js = content_type.contains("javascript")
        || content_type.contains("application/x-javascript")
        || url_lower.ends_with(".js")
        || url_lower.contains(".js?");

    if is_js {
        if let Ok(js_str) = String::from_utf8(body.clone()) {
            let mut modified = false;
            let mut new_js = js_str;

            if new_js.contains("new WebSocket(") {
                new_js = new_js.replace("new WebSocket(", "new (window.__SDC_SAFE_WS || window.WebSocket)(");
                modified = true;
            }
            if new_js.contains("new window.WebSocket(") {
                new_js = new_js.replace("new window.WebSocket(", "new (window.__SDC_SAFE_WS || window.WebSocket)(");
                modified = true;
            }

            let sockjs_scheme_err = "The URL's scheme must be either";
            if new_js.contains(sockjs_scheme_err) {
                new_js = new_js.replace("throw new SyntaxError(\"The URL's scheme", "console.warn(\"SDC Suppressed: The URL's scheme");
                new_js = new_js.replace("throw new SyntaxError('The URL\\'s scheme", "console.warn('SDC Suppressed: The URL\\'s scheme");
                modified = true;
            }

            let sockjs_invalid_err = "is invalid\")";
            if new_js.contains(sockjs_invalid_err) || new_js.contains("is invalid')") {
                new_js = new_js.replace("throw new SyntaxError(\"The URL '\"", "console.warn(\"SDC Suppressed: The URL '\"");
                new_js = new_js.replace("throw new SyntaxError('The URL \\''", "console.warn('SDC Suppressed: The URL \\''");
                modified = true;
            }

            if new_js.contains("SecurityError: An insecure SockJS connection") {
                new_js = new_js.replace("throw new Error(\"SecurityError:", "console.warn(\"SDC Suppressed: SecurityError:");
                new_js = new_js.replace("throw new Error('SecurityError:", "console.warn('SDC Suppressed: SecurityError:");
                modified = true;
            }

            if modified {
                body = new_js.into_bytes();
            }
        }
    }

    let mut response_builder = Response::builder().status(status.as_u16());
    for (name, value) in headers.iter() {
        let name_str = name.as_str().to_lowercase();
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

    Ok(response_builder
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Credentials", "true")
        .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE, PATCH")
        .header("Access-Control-Allow-Headers", "*")
        .header("Access-Control-Expose-Headers", "*")
        .header("X-Frame-Options", "ALLOWALL")
        .header("Referrer-Policy", "unsafe-url")
        .header("Content-Security-Policy", "default-src * 'unsafe-inline' 'unsafe-eval' data: blob: sandra-app:;")
        .body(body)?)
}
