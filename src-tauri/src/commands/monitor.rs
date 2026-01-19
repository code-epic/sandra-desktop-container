use sysinfo::{System, Disks};
use serde::Serialize;

#[derive(Serialize)]
pub struct SystemStats {
    pub free_memory: u64,
    pub total_memory: u64,
    pub disks: Vec<DiskStats>,
}

#[derive(Serialize)]
pub struct DiskStats {
    
    pub name: String,
    pub free_space: u64,
    pub total_space: u64,
}

#[tauri::command]
pub async fn get_system_telemetry() -> Result<SystemStats, String> {
    // 1. Obtener memoria
    let mut sys = System::new_all();
    sys.refresh_all();

    // 2. Obtener Discos (En sysinfo v0.30 se usa la struct Disks por separado)
    let disks_list = Disks::new_with_refreshed_list();
    let disks = disks_list.iter().map(|disk| DiskStats {
        name: disk.mount_point().to_string_lossy().into_owned(),
        free_space: disk.available_space(),
        total_space: disk.total_space(),
    }).collect();

    Ok(SystemStats {
        free_memory: sys.free_memory(),
        total_memory: sys.total_memory(),
        disks,
    })
}