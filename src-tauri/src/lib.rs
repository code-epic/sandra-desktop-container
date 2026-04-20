pub mod commands;
pub mod crypto;
pub mod proxy;
pub mod remote_control;
pub mod sha256;
pub mod storage;

use crate::storage::DbState;
use std::sync::Mutex;
use tauri::async_runtime::JoinHandle;
use tauri::Manager;

pub struct ConnectionTask(pub Mutex<Option<JoinHandle<()>>>);
pub struct WsStatus(pub Mutex<String>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // .plugin(tauri_plugin_fs::init())
        .register_uri_scheme_protocol("sandra-app", |app_handle, request| {
            proxy::handle_request(app_handle.app_handle(), &request)
        })
        // .plugin(tauri_plugin_shell::init())
        // .plugin(tauri_plugin_dialog::init())
        // .setup(move |app| {
        //     println!("🚀 [Tauri] Iniciando setup...");
        //     let conn = storage::initialize_db(&app.handle()).expect("Error al inicializar SQLite");
        //     app.manage(DbState(Mutex::new(conn)));
        //     app.manage(ConnectionTask(Mutex::new(None)));
        //     // Asegurar que splash esté visible y top
        //     /* if let Some(splash) = app.get_webview_window("splashscreen") {
        //          splash.show().unwrap();
        //          splash.set_focus().unwrap();
        //     } */
        //     println!("✅ [Tauri] Setup finalizado correctamente.");
        //     Ok(())
        // })
        .plugin(tauri_plugin_fs::init())
        // .register_uri_scheme_protocol("sandra-app", |app_handle, request| {
        //     println!("🚀 [Tauri] Procesando solicitud...");
        //     proxy_handler::handle_request(app_handle.app_handle(), &request)
        // })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(move |app| {
            let conn = storage::initialize_db(&app.handle()).expect("Error al inicializar SQLite");
            app.manage(DbState(Mutex::new(conn)));
            app.manage(ConnectionTask(Mutex::new(None)));
            app.manage(WsStatus(Mutex::new("disconnected".to_string())));

            // FALLBACK DE SEGURIDAD PARA WINDOWS:
            // Si por alguna razón el frontend falla al cerrar el splash, 
            // lo cerramos nosotros después de un tiempo prudencial para no bloquear al usuario.
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(15)).await;
                if let Some(splash) = app_handle.get_webview_window("splashscreen") {
                    let _ = splash.close();
                }
                if let Some(main) = app_handle.get_webview_window("main") {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::monitor::get_system_telemetry,
            commands::system::get_network_info,
            commands::system::remote_reboot,
            commands::system::export_database,
            commands::system::reset_database,
            commands::apps::download_app_repo,
            commands::apps::open_app_window,
            commands::apps::update_app_repo,
            commands::apps::delete_app_repo,
            commands::apps::verify_app_installed,
            commands::apps::get_all_apps,
            commands::apps::create_app,
            commands::apps::update_app,
            commands::apps::delete_app,
            commands::handler_error::save_app_log,
            commands::handler_error::get_app_logs,
            commands::handler_error::clear_app_logs,
            commands::handler_error::get_db_stats,
            commands::handler_error::get_table_columns,
            commands::connections::get_or_create_client_id,
            commands::connections::get_setup_status,
            commands::connections::save_setup_data,
            commands::connections::get_local_ip,
            commands::connections::verify_connection_status,
            commands::connections::save_connection,
            commands::connections::get_connections,
            commands::connections::delete_connection,
            commands::connections::get_hash_preview,
            commands::connections::get_ws_status,
            commands::api::api_post_request,
            commands::api::api_get_request,
            commands::api::api_post_stream_request,
            commands::file_upload::process_and_upload,
            commands::connections::update_connection_auth,
            commands::connections::connect_to_server,
            commands::connections::disconnect_from_server,
            commands::window::close_splash,
            commands::window::emit_splash_status,
            commands::window::exit_app,
            commands::pdf::save_protected_pdf,
            commands::pdf::load_sse_document,
            commands::pdf::print_pdf_direct,
            commands::pdf::prepare_sse_preview,
            commands::history::add_document_history,
            commands::history::get_document_history,
            commands::history::delete_document_history,
            commands::history::delete_document_group,
            commands::history::save_chat_messages,
            commands::history::get_chat_history,
            // Mailbox Module
            commands::mailbox::mailbox_download_attachment,
            commands::mailbox::get_mailbox_messages,
            commands::mailbox::sync_mailbox,
            commands::mailbox::create_mailbox_message,
            commands::mailbox::update_mailbox_status,
            commands::mailbox::delete_mailbox_message,
            commands::mailbox::ingest_secure_package,
            commands::mailbox::generate_secure_package,
            // Security Module
            commands::security::get_security_config,
            commands::security::update_security_config,
            commands::security::get_proxy_routes,
            commands::security::create_proxy_route,
            commands::security::delete_proxy_route,
            commands::security::sha256_hash,
            commands::security::sha256_hash_file,
            commands::security::hmac_sha256,
            commands::security::encrypt_device_context,
            commands::security::register_authorization_ticket,
            commands::security::get_authorization_tickets,
            commands::security::get_authorization_ticket_by_id,
            commands::security::delete_authorization_ticket,
            commands::security::update_authorization_ticket_status,
            commands::security::process_hsf_authorization,
            commands::cifrado::aplicar_capa_seguridad,
            commands::cifrado::remover_capa_seguridad,
            commands::gpg::encrypt_gpg_symmetric_raw,
            commands::gpg::decrypt_gpg_symmetric_file_raw,
            commands::file_upload::verify_file_seal,
            commands::file_upload::apply_alquimia_seal,
            commands::secure_download::procesar_descarga_segura
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
