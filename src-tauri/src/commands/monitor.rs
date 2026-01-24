use mac_address::get_mac_address;
use serde::Serialize;
use sysinfo::{Disks, System};

#[derive(Serialize)]
pub struct SystemStats {
    pub disk_total: u64,
    pub disk_free: u64,
    pub os_info: String,
    pub mac_address: String,
}

#[tauri::command]
pub async fn get_system_telemetry() -> Result<SystemStats, String> {
    let mut sys = System::new_all();
    sys.refresh_all();

    // Calcular Espacio Total y Disponible Global (Suma de todos los discos)
    let disks = Disks::new_with_refreshed_list();
    let mut total_space = 0;
    let mut available_space = 0;

    for disk in &disks {
        total_space += disk.total_space();
        available_space += disk.available_space();
    }

    // Obtener Info del SO
    let os_name = System::name().unwrap_or("Unknown".to_string());
    let os_version = System::os_version().unwrap_or("".to_string());
    let os_info = format!("{} {}", os_name, os_version).trim().to_string();

    // Obtener MAC Address Real
    let mac = match get_mac_address() {
        Ok(Some(mac)) => mac.to_string(),
        Ok(None) => "No MAC Found".to_string(),
        Err(_) => "Unknown MAC".to_string(),
    };

    Ok(SystemStats {
        disk_total: total_space,
        disk_free: available_space,
        os_info,
        mac_address: mac,
    })
}
