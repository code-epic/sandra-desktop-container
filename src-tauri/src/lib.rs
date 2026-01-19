use std::fs;
pub mod commands;
pub mod remote_control;
pub mod storage;

use crate::storage::DbState;
use std::sync::Mutex;
use tauri::http::header::CONTENT_TYPE;
use tauri::Manager;
use uuid::Uuid;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Generamos el UUID v4 para esta sesión o instancia
    let client_id = Uuid::new_v4().to_string();
    let client_name = "User-SDC-Alpha"; // Esto podría venir de un config.json luego

    // Construimos la URL con los parámetros dinámicos
    let ws_url = format!(
        "wss://localhost:8443/sandra_ws?userId={}&userName={}",
        client_id, client_name
    );

    tauri::Builder::default()
        .register_uri_scheme_protocol("sandra-app", |app_handle, request| {
            let uri = request.uri();
            let path = uri.path();
            let app_dir = app_handle
                .app_handle()
                .path()
                .app_data_dir()
                .expect("Error al obtener AppData");
            let clean_path = path.trim_start_matches('/');
            let mut file_path = app_dir.join("apps").join(clean_path);
            if path.ends_with('/') || !path.contains('.') {
                file_path = file_path.join("dist").join("index.html");
            } else {
                let parts: Vec<&str> = clean_path.splitn(2, '/').collect();
                if parts.len() == 2 {
                    let app_id = parts[0];
                    let asset_path = parts[1];
                    file_path = app_dir
                        .join("apps")
                        .join(app_id)
                        .join("dist")
                        .join(asset_path);
                }
            }

            match fs::read(&file_path) {
                Ok(content) => {
                    let extension = file_path
                        .extension()
                        .and_then(|s: &std::ffi::OsStr| s.to_str())
                        .unwrap_or("");

                    let mime_type = match extension {
                        "html" => "text/html",
                        "js" => "application/javascript",
                        "css" => "text/css",
                        "svg" => "image/svg+xml",
                        "png" => "image/png",
                        _ => "application/octet-stream",
                    };

                    // tauri::http::Response::builder()
                    //     .header(CONTENT_TYPE, mime_type)
                    //     .body(content)
                    //     .unwrap()

                    tauri::http::Response::builder()
                        .header(CONTENT_TYPE, mime_type)
                        .header("Access-Control-Allow-Origin", "*") // Permite comunicación con el host
                        .header(
                            "Content-Security-Policy",
                            "default-src 'self' 'unsafe-inline' sandra-app: asset: tauri:;",
                        )
                        .body(content)
                        .unwrap()
                }
                Err(_) => tauri::http::Response::builder()
                    .status(404)
                    .header(CONTENT_TYPE, "text/plain")
                    .body(
                        "Archivo no encontrado en el repositorio local"
                            .as_bytes()
                            .to_vec(),
                    )
                    .unwrap(),
            }
        })
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            // 1. Inicializar DB y Estado
            let conn = storage::initialize_db(&app.handle()).expect("Error al inicializar SQLite");
            app.manage(DbState(Mutex::new(conn)));

            // 2. Arrancar el Listener del Centro de Mando (WebSocket)
            // Lo corremos en el runtime de Tokio de Tauri para no bloquear la UI
            // 2. Listener WebSocket ahora es bajo demanda (ver connect_to_server)

            Ok(())
            // // 1. Obtener la ventana principal
            // let main_window = app.get_webview_window("main").unwrap();

            // // 2. Configuración estética Multiplataforma
            // // En macOS, esto hace que los botones (cerrar, min, max) floten sobre tu HTML
            // #[cfg(target_os = "macos")]
            // {
            //     use tauri::TitleBarStyle;
            //     let _ = main_window.set_title_bar_style(TitleBarStyle::Overlay);
            // }

            // // 3. Inicializar DB y Estado
            // let conn = storage::initialize_db(&app.handle())
            //     .expect("Error al inicializar SQLite");
            // app.manage(DbState(Mutex::new(conn)));

            // // ... resto de tu código de WebSocket ...
            // Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::monitor::get_system_telemetry,
            commands::system::get_network_info,
            commands::system::remote_reboot,
            commands::apps::download_app_repo,
            commands::apps::open_app_window,
            commands::apps::update_app_repo,
            commands::apps::delete_app_repo,
            commands::apps::verify_app_installed,
            commands::handler_error::save_app_log,
            commands::handler_error::get_app_logs,
            commands::handler_error::clear_app_logs,
            commands::handler_error::get_db_stats,
            commands::handler_error::get_table_columns,
            commands::connections::get_or_create_client_id,
            commands::connections::get_local_ip,
            commands::connections::verify_connection_status,
            commands::connections::save_connection,
            commands::connections::get_connections,
            commands::connections::delete_connection,
            commands::connections::connect_to_server,
            commands::connections::disconnect_from_server
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn get_or_create_client_id(conn: &rusqlite::Connection) -> String {
    let mut stmt = conn
        .prepare("SELECT value FROM config WHERE key = 'client_id'")
        .unwrap();
    let existing_id: Result<String, _> = stmt.query_row([], |row| row.get(0));

    match existing_id {
        Ok(id) => id,
        Err(_) => {
            let new_id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO config (key, value) VALUES ('client_id', ?)",
                [&new_id],
            )
            .unwrap();
            new_id
        }
    }
}
