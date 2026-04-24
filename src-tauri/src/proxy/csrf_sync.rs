use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::http::Response;
use tauri::AppHandle;

use super::auditor::{emit_network_log, NetworkEventDetails, NetworkEventPayload};
use super::utils::create_response;

// CSRF Sync: Cliente HTTP con Cookie Jar
static CSRF_SYNC_CLIENTS: OnceLock<Mutex<HashMap<String, reqwest::blocking::Client>>> =
    OnceLock::new();

fn get_or_create_csrf_client(
    app_id: &str,
) -> Result<reqwest::blocking::Client, Box<dyn std::error::Error>> {
    let clients_map = CSRF_SYNC_CLIENTS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut map = clients_map.lock().unwrap();

    if let Some(client) = map.get(app_id) {
        return Ok(client.clone());
    }

    let client = reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .danger_accept_invalid_certs(true)
        .cookie_store(true)
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    map.insert(app_id.to_string(), client.clone());
    Ok(client)
}

pub fn proxy_csrf_sync_url(
    app_handle: &AppHandle,
    app_id: &str,
    remote_url: &str,
    request: &tauri::http::Request<Vec<u8>>,
) -> Result<Response<Vec<u8>>, Box<dyn std::error::Error>> {
    let client = get_or_create_csrf_client(app_id)?;

    // WebSocket bypass
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

    let mut audit_headers = HashMap::new();
    for (name, value) in request.headers().iter() {
        let name_str = name.as_str().to_lowercase();
        if name_str != "host" && name_str != "cookie" {
            req_builder = req_builder.header(name, value);
            if let Ok(v) = value.to_str() {
                audit_headers.insert(name.as_str().to_string(), v.to_string());
            }
        }
    }

    // Set Origin
    if let Ok(parsed_url) = url::Url::parse(remote_url) {
        let target_origin = format!(
            "{}://{}",
            parsed_url.scheme(),
            parsed_url.host_str().unwrap_or("")
        );
        req_builder = req_builder.header("Origin", &target_origin);
    }

    let body_bytes = request.body().clone();
    if !body_bytes.is_empty() {
        req_builder = req_builder.body(body_bytes);
    }

    let resp = req_builder.send()?;
    let status = resp.status();
    println!(
        "🔐 [CSRF Sync] {} {} -> {}",
        method,
        remote_url,
        status.as_u16()
    );

    let headers = resp.headers().clone();
    let body = resp.bytes()?.to_vec();

    // Auditoría
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
        message: format!(
            "{} {} [{}] (CSRF Sync)",
            method,
            remote_url,
            status.as_u16()
        ),
        details: NetworkEventDetails {
            url: remote_url.to_string(),
            method: method.to_string(),
            status: status.as_u16(),
            request_headers: audit_headers,
            response_body: response_body_str,
            source: "CSRF Sync Proxy".to_string(),
        },
    };
    emit_network_log(app_handle, audit_payload);

    let mut response_builder = Response::builder().status(status.as_u16());
    for (name, value) in headers.iter() {
        let name_str = name.as_str().to_lowercase();
        if name_str != "set-cookie"
            && name_str != "x-frame-options"
            && name_str != "content-security-policy"
            && name_str != "access-control-allow-origin"
            && name_str != "content-encoding"
            && name_str != "content-length"
            && name_str != "transfer-encoding"
        {
            response_builder = response_builder.header(name, value);
        }
    }

    Ok(response_builder
        .header("Access-Control-Allow-Origin", "*")
        .header("X-Frame-Options", "ALLOWALL")
        .body(body)?)
}
