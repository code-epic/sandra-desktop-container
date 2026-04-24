use crate::commands::connections::Connection;
use crate::storage::DbState;
use rusqlite::OptionalExtension;
use std::collections::HashMap;
use tauri::http::{Request, Response};
use tauri::{AppHandle, Manager};

use super::auditor::{emit_network_log, NetworkEventDetails, NetworkEventPayload};

pub fn get_active_connection(app_handle: &AppHandle) -> Option<Connection> {
    let state = app_handle.state::<DbState>();
    let conn_guard = state.0.lock().ok()?;

    let mut query = "SELECT id, name, ip_address, port, username, password, last_connected, wss_host, wss_port, is_connected, jwt, hash FROM connections WHERE is_connected = 1 LIMIT 1";

    let mut result = conn_guard
        .query_row(query, [], |row| {
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
                jwt: row.get(10).ok(),
                hash: row.get(11).ok(),
            })
        })
        .optional()
        .unwrap_or(None);

    if result.is_none() {
        println!("⚠️ [Proxy] No active connection marked in DB. Attempting fallback...");
        query = "SELECT id, name, ip_address, port, username, password, last_connected, wss_host, wss_port, is_connected, jwt, hash FROM connections LIMIT 1";

        result = conn_guard
            .query_row(query, [], |row| {
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
                    jwt: row.get(10).ok(),
                    hash: row.get(11).ok(),
                })
            })
            .optional()
            .unwrap_or(None);
    }

    if let Some(ref conn) = result {
        println!(
            "✅ [Proxy] Routing via: {} ({}:{})",
            conn.name, conn.ip_address, conn.port
        );
    } else {
        println!("🚫 [Proxy] CRITICAL: No Connections configured in Database.");
    }

    result
}

pub fn is_app_proxy_required(app_handle: &AppHandle, app_id: &str) -> bool {
    if app_id.is_empty() {
        return false;
    }

    let state = app_handle.state::<DbState>();
    let result = if let Ok(conn) = state.0.lock() {
        let query = "SELECT is_proxy_required FROM desktop_apps WHERE app_id = ?1";
        conn.query_row(query, [app_id], |row| row.get(0))
            .unwrap_or(false)
    } else {
        false
    };
    result
}

pub fn proxy_to_remote(
    app_handle: &AppHandle,
    app_id_for_audit: &str,
    conn: Connection,
    request: &Request<Vec<u8>>,
) -> Result<Response<Vec<u8>>, Box<dyn std::error::Error>> {
    let remote_ip = conn.ip_address;
    let remote_port = conn.port;
    let path = request.uri().path();
    let query = request.uri().query();

    let remote_url = if let Some(q) = query {
        format!("https://{}:{}{}?{}", remote_ip, remote_port, path, q)
    } else {
        format!("https://{}:{}{}", remote_ip, remote_port, path)
    };
    println!("🚀 [Proxy] Forwarding to: {}", remote_url);

    let method = request.method().clone();
    let client = reqwest::blocking::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(60))
        .build()?;

    let mut req_builder = client.request(method.clone(), &remote_url);
    let mut audit_headers = HashMap::new();

    for (name, value) in request.headers().iter() {
        let name_str = name.as_str().to_lowercase();
        if name_str != "host" {
            req_builder = req_builder.header(name, value);
            if let Ok(v) = value.to_str() {
                audit_headers.insert(name.as_str().to_string(), v.to_string());
            }
        }
    }

    let target_origin = format!("https://{}:{}", remote_ip, remote_port);
    req_builder = req_builder.header("Origin", &target_origin);

    let body_bytes = request.body().clone();
    if !body_bytes.is_empty() {
        req_builder = req_builder.body(body_bytes.clone());
    }

    let resp = req_builder.send()?;
    let status = resp.status();
    let headers = resp.headers().clone();
    let resp_body = resp.bytes()?.to_vec();

    // AUDITORÍA: Emitir el evento de red capturado
    let response_body_str = match String::from_utf8(resp_body.clone()) {
        Ok(s) => {
            if s.len() > 5000 {
                format!("{}... (truncated)", &s[..5000])
            } else {
                s
            }
        }
        Err(_) => "[Binary Data or Invalid UTF-8]".to_string(),
    };

    let audit_payload = NetworkEventPayload {
        app_id: app_id_for_audit.to_string(),
        log_type: if status.is_success() {
            "FETCH".to_string()
        } else {
            "ERROR".to_string()
        },
        message: format!("{} {} [{}]", method, remote_url, status.as_u16()),
        details: NetworkEventDetails {
            url: remote_url,
            method: method.to_string(),
            status: status.as_u16(),
            request_headers: audit_headers,
            response_body: response_body_str,
            source: "Rust Proxy".to_string(),
        },
    };
    emit_network_log(app_handle, audit_payload);

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
        .header(
            "Access-Control-Allow-Methods",
            "GET, POST, OPTIONS, PUT, DELETE, PATCH",
        )
        .header("Access-Control-Allow-Headers", "*")
        .header("Access-Control-Expose-Headers", "*")
        .header("X-Frame-Options", "ALLOWALL")
        .header("Referrer-Policy", "unsafe-url")
        .header(
            "Content-Security-Policy",
            "default-src * 'unsafe-inline' 'unsafe-eval' data: blob: sandra-app:;",
        )
        .body(resp_body)?)
}

pub fn is_app_limitless(app_handle: &AppHandle, app_id: &str) -> bool {
    if app_id.is_empty() {
        return false;
    }

    let state = app_handle.state::<DbState>();
    let result = if let Ok(conn) = state.0.lock() {
        let query = "SELECT is_limitless FROM desktop_apps WHERE app_id = ?1";
        conn.query_row(query, [app_id], |row| row.get(0))
            .unwrap_or(false)
    } else {
        false
    };
    result
}

pub fn is_app_csrf_sync(app_handle: &AppHandle, app_id: &str) -> bool {
    if app_id.is_empty() {
        return false;
    }

    let state = app_handle.state::<DbState>();
    let result = if let Ok(conn) = state.0.lock() {
        let query = "SELECT is_csrf_sync FROM desktop_apps WHERE app_id = ?1";
        conn.query_row(query, [app_id], |row| row.get(0))
            .unwrap_or(false)
    } else {
        false
    };
    result
}

pub fn is_app_bypass(app_handle: &AppHandle, app_id: &str) -> bool {
    if app_id.is_empty() {
        return false;
    }

    let state = app_handle.state::<DbState>();
    let result = if let Ok(conn) = state.0.lock() {
        let query = "SELECT is_bypass FROM desktop_apps WHERE app_id = ?1";
        conn.query_row(query, [app_id], |row| row.get(0))
            .unwrap_or(false)
    } else {
        false
    };
    result
}
