use local_ip_address::local_ip;
use std::process::Command;

#[tauri::command]
pub async fn get_network_info() -> Result<Vec<String>, String> {
    let mut info = Vec::new();

    // IP Local
    if let Ok(my_local_ip) = local_ip() {
        info.push(format!("Local: {}", my_local_ip));
    }

    // IP Pública
    let client = reqwest::Client::new();
    if let Ok(response) = client.get("https://api.ipify.org").send().await {
        if let Ok(ip_pub) = response.text().await {
            info.push(format!("Public: {}", ip_pub));
        }
    }

    Ok(info)
}

#[tauri::command]
pub fn remote_reboot() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("shutdown")
            .args(["/r", "/t", "0"])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        Command::new("reboot").spawn().map_err(|e| e.to_string())?;
    }

    Ok("Señal de reinicio enviada".into())
}

#[tauri::command]
pub fn export_database(
    app_handle: tauri::AppHandle,
    target_path: String,
) -> Result<String, String> {
    use std::fs;
    use tauri::Manager;

    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let db_path = app_dir.join("sdc_secure_core.db");

    if !db_path.exists() {
        return Err("La base de datos no existe".into());
    }

    fs::copy(&db_path, &target_path).map_err(|e| e.to_string())?;

    Ok("Base de datos exportada correctamente".into())
}

#[tauri::command]
pub fn reset_database(state: tauri::State<'_, crate::storage::DbState>) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    // 1. Eliminar todas las tablas
    conn.execute_batch(
        "
        DROP TABLE IF EXISTS connections;
        DROP TABLE IF EXISTS desktop_apps;
        DROP TABLE IF EXISTS app_logs;
        DROP TABLE IF EXISTS system_events;
        DROP TABLE IF EXISTS config;
        DROP TABLE IF EXISTS desktop_apps;
    ",
    )
    .map_err(|e| e.to_string())?;

    // 2. Reconstruir esquema
    crate::storage::init_tables(&conn)?;

    // 3. Re-sembrar datos por defecto
    crate::storage::seed_db(&conn)?;

    Ok("Base de datos reiniciada correctamente".into())
}

#[derive(serde::Serialize)]
pub struct DiagnosticStep {
    pub name: String,
    pub success: bool,
    pub message: String,
    pub duration_ms: u64,
}

#[derive(serde::Serialize)]
pub struct DiagnosticReport {
    pub target_url: String,
    pub parsed_domain: String,
    pub parsed_port: u16,
    pub dns_ips: Vec<String>,
    pub tcp_connected: bool,
    pub http_status: Option<u16>,
    pub http_headers: std::collections::HashMap<String, String>,
    pub steps: Vec<DiagnosticStep>,
}

#[tauri::command]
pub async fn run_network_diagnostics(target_url: String) -> Result<DiagnosticReport, String> {
    use std::collections::HashMap;
    use std::time::Instant;
    use tokio::net::lookup_host;
    use tokio::time::{timeout, Duration};
    use url::Url;

    let mut steps = Vec::new();
    let mut dns_ips = Vec::new();
    let mut tcp_connected = false;
    let mut http_status = None;
    let mut http_headers = HashMap::new();

    // 1. Parse URL
    let parse_start = Instant::now();
    let url = match Url::parse(&target_url) {
        Ok(u) => u,
        Err(e) => {
            steps.push(DiagnosticStep {
                name: "Análisis de URL".to_string(),
                success: false,
                message: format!("URL inválida '{}': {}", target_url, e),
                duration_ms: parse_start.elapsed().as_millis() as u64,
            });
            return Ok(DiagnosticReport {
                target_url,
                parsed_domain: "".to_string(),
                parsed_port: 0,
                dns_ips,
                tcp_connected,
                http_status,
                http_headers,
                steps,
            });
        }
    };

    let domain = url.host_str().unwrap_or("localhost").to_string();
    let port = url.port_or_known_default().unwrap_or(80);

    steps.push(DiagnosticStep {
        name: "Análisis de URL".to_string(),
        success: true,
        message: format!("Dominio extraído: '{}', Puerto: {}", domain, port),
        duration_ms: parse_start.elapsed().as_millis() as u64,
    });

    // 2. DNS Resolution
    let dns_start = Instant::now();
    let socket_addr_str = format!("{}:{}", domain, port);
    match lookup_host(&socket_addr_str).await {
        Ok(addrs) => {
            for addr in addrs {
                dns_ips.push(addr.ip().to_string());
            }
            if dns_ips.is_empty() {
                steps.push(DiagnosticStep {
                    name: "Resolución de DNS".to_string(),
                    success: false,
                    message: "No se encontraron IPs asociadas a este dominio.".to_string(),
                    duration_ms: dns_start.elapsed().as_millis() as u64,
                });
            } else {
                steps.push(DiagnosticStep {
                    name: "Resolución de DNS".to_string(),
                    success: true,
                    message: format!("Resuelto a {} IPs: {:?}", dns_ips.len(), dns_ips),
                    duration_ms: dns_start.elapsed().as_millis() as u64,
                });
            }
        }
        Err(e) => {
            steps.push(DiagnosticStep {
                name: "Resolución de DNS".to_string(),
                success: false,
                message: format!(
                    "Fallo al resolver dominio '{}'. ¿Está conectada la VPN? Detalle: {}",
                    domain, e
                ),
                duration_ms: dns_start.elapsed().as_millis() as u64,
            });
        }
    }

    // 3. TCP Port Ping
    if !dns_ips.is_empty() {
        let tcp_start = Instant::now();
        let target_socket = format!("{}:{}", dns_ips[0], port);
        match target_socket.parse::<std::net::SocketAddr>() {
            Ok(addr) => {
                match timeout(Duration::from_secs(4), tokio::net::TcpStream::connect(addr)).await {
                    Ok(Ok(_)) => {
                        tcp_connected = true;
                        steps.push(DiagnosticStep {
                            name: "Prueba de Puerto TCP (Ping)".to_string(),
                            success: true,
                            message: format!(
                                "Conexión TCP establecida con éxito a {} en el puerto {}",
                                dns_ips[0], port
                            ),
                            duration_ms: tcp_start.elapsed().as_millis() as u64,
                        });
                    }
                    Ok(Err(e)) => {
                        steps.push(DiagnosticStep {
                            name: "Prueba de Puerto TCP (Ping)".to_string(),
                            success: false,
                            message: format!("Fallo de conexión TCP a {} en el puerto {}. ¿El puerto está bloqueado o el servidor apagado? Detalle: {}", dns_ips[0], port, e),
                            duration_ms: tcp_start.elapsed().as_millis() as u64,
                        });
                    }
                    Err(_) => {
                        steps.push(DiagnosticStep {
                            name: "Prueba de Puerto TCP (Ping)".to_string(),
                            success: false,
                            message: format!("Tiempo de espera agotado (4s) intentando conectar a {} en el puerto {}", dns_ips[0], port),
                            duration_ms: tcp_start.elapsed().as_millis() as u64,
                        });
                    }
                }
            }
            Err(e) => {
                steps.push(DiagnosticStep {
                    name: "Prueba de Puerto TCP (Ping)".to_string(),
                    success: false,
                    message: format!("Fallo al parsear dirección de red: {}", e),
                    duration_ms: tcp_start.elapsed().as_millis() as u64,
                });
            }
        }
    } else {
        steps.push(DiagnosticStep {
            name: "Prueba de Puerto TCP (Ping)".to_string(),
            success: false,
            message: "Omitido debido a fallo previo en resolución DNS.".to_string(),
            duration_ms: 0,
        });
    }

    // 4. HTTP Handshake
    if tcp_connected {
        let http_start = Instant::now();
        let client_res = reqwest::Client::builder()
            .timeout(Duration::from_secs(6))
            .danger_accept_invalid_certs(true)
            .build();

        match client_res {
            Ok(client) => {
                match client
                    .get(&target_url)
                    .header("User-Agent", "SandraDC-Diagnostics/1.0")
                    .send()
                    .await
                {
                    Ok(resp) => {
                        let status = resp.status();
                        http_status = Some(status.as_u16());
                        for (name, value) in resp.headers().iter() {
                            if let Ok(val_str) = value.to_str() {
                                http_headers.insert(name.as_str().to_string(), val_str.to_string());
                            }
                        }
                        steps.push(DiagnosticStep {
                            name: "Petición de Protocolo HTTP".to_string(),
                            success: status.is_success() || status.is_redirection(),
                            message: format!(
                                "Respuesta HTTP recibida: {} {}. Latencia total: {}ms",
                                status.as_u16(),
                                status.canonical_reason().unwrap_or(""),
                                http_start.elapsed().as_millis()
                            ),
                            duration_ms: http_start.elapsed().as_millis() as u64,
                        });
                    }
                    Err(e) => {
                        steps.push(DiagnosticStep {
                            name: "Petición de Protocolo HTTP".to_string(),
                            success: false,
                            message: format!("Error al enviar HTTP GET handshake: {}", e),
                            duration_ms: http_start.elapsed().as_millis() as u64,
                        });
                    }
                }
            }
            Err(e) => {
                steps.push(DiagnosticStep {
                    name: "Petición de Protocolo HTTP".to_string(),
                    success: false,
                    message: format!("No se pudo inicializar el cliente HTTP reqwest: {}", e),
                    duration_ms: http_start.elapsed().as_millis() as u64,
                });
            }
        }
    } else {
        steps.push(DiagnosticStep {
            name: "Petición de Protocolo HTTP".to_string(),
            success: false,
            message: "Omitido debido a falta de conectividad TCP básica.".to_string(),
            duration_ms: 0,
        });
    }

    Ok(DiagnosticReport {
        target_url,
        parsed_domain: domain,
        parsed_port: port,
        dns_ips,
        tcp_connected,
        http_status,
        http_headers,
        steps,
    })
}

#[derive(serde::Serialize)]
pub struct BuildInfo {
    pub version: String,
    pub build_timestamp: u64,
}

#[tauri::command]
pub fn get_build_info() -> BuildInfo {
    let version = env!("CARGO_PKG_VERSION").to_string();
    let timestamp_str = env!("BUILD_TIMESTAMP");
    let build_timestamp = timestamp_str.parse::<u64>().unwrap_or(0);
    BuildInfo {
        version,
        build_timestamp,
    }
}
