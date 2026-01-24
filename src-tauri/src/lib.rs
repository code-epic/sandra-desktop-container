pub mod commands;
pub mod proxy_handler;
pub mod remote_control;
pub mod storage;

use crate::storage::DbState;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .register_uri_scheme_protocol("sandra-app", |app_handle, request| {
            proxy_handler::handle_request(app_handle.app_handle(), &request)
        })
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            let conn = storage::initialize_db(&app.handle()).expect("Error al inicializar SQLite");
            app.manage(DbState(Mutex::new(conn)));
            Ok(())
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
