use local_ip_address::local_ip;
use reqwest::blocking::get;
use std::process::Command;

#[tauri::command]
pub fn get_network_info() -> Result<Vec<String>, String> {
    let mut info = Vec::new();

    // IP Local
    if let Ok(my_local_ip) = local_ip() {
        info.push(format!("Local: {}", my_local_ip));
    }

    // IP Pública
    if let Ok(response) = get("https://api.ipify.org") {
        if let Ok(ip_pub) = response.text() {
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
