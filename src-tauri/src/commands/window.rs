use tauri::{AppHandle, Manager};

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
