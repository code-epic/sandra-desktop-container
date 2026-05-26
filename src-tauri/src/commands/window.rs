use tauri::{AppHandle, Emitter, Manager};

#[tauri::command]
pub async fn close_splash(app_handle: AppHandle) {
    // println!("🌊 [Splash] Comando close_splash recibido desde Frontend");
    if let Some(splash_window) = app_handle.get_webview_window("splashscreen") {
        // println!("🌊 [Splash] Cerrando ventana splashscreen...");
        splash_window.close().unwrap();
        // println!("🌊 [Splash] Ventana splashscreen cerrada.");
    } else {
        println!("⚠️ [Splash] No se encontró la ventana 'splashscreen'");
    }

    if let Some(main_window) = app_handle.get_webview_window("main") {
        // println!("🌊 [Splash] Mostrando ventana main...");
        main_window.show().unwrap();
        main_window.set_focus().unwrap();
        // println!("🌊 [Splash] Ventana main mostrada y enfocada.");
    } else {
        // println!("⚠️ [Splash] No se encontró la ventana 'main'");
    }
}

#[tauri::command]
pub fn emit_splash_status(app_handle: AppHandle, message: String) {
    let _ = app_handle.emit("splash-status", message);
}

#[tauri::command]
pub fn exit_app(app_handle: AppHandle) {
    app_handle.exit(0);
}

#[tauri::command]
pub fn open_devtools(webview_window: tauri::WebviewWindow) {
    webview_window.open_devtools();
}

