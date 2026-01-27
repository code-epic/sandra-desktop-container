use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn close_splash(app_handle: AppHandle) {
    if let Some(splash_window) = app_handle.get_webview_window("splashscreen") {
        splash_window.close().unwrap();
    }
    if let Some(main_window) = app_handle.get_webview_window("main") {
        main_window.show().unwrap();
        main_window.set_focus().unwrap();
    }
}
