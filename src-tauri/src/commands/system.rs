use std::process::Command;
use local_ip_address::local_ip;
use reqwest::blocking::get;


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
        Command::new("reboot")
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok("Señal de reinicio enviada".into())
}