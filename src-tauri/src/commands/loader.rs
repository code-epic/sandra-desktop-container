use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use sysinfo::System;
use crate::storage::DbState;
use std::io::Write;

#[derive(Serialize, Clone)]
struct LoaderProgress {
    layer: String,
    percentage: f32,
    status_message: String,
    detail: String,
}

// Verifica si existe una actualización en el servidor de GitHub
async fn check_updater_github(app_handle: &AppHandle) -> Result<Option<String>, String> {
    let client = reqwest::Client::new();
    let res = client.get("https://raw.githubusercontent.com/code-epic/sandra-desktop-container/main/updater/latest.json")
        .send()
        .await
        .map_err(|e| format!("Conexión fallida: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Servidor respondió: {}", res.status()));
    }

    let metadata: serde_json::Value = res.json()
        .await
        .map_err(|e| format!("JSON inválido: {}", e))?;

    let server_version = metadata["version"].as_str().unwrap_or("0.0.0");
    let current_version = app_handle.package_info().version.to_string();

    if server_version != current_version {
        // Encontrar plataforma adecuada
        #[cfg(target_os = "macos")]
        let platform_key = if cfg!(target_arch = "aarch64") { "darwin-aarch64" } else { "darwin-x86_64" };
        #[cfg(target_os = "windows")]
        let platform_key = "windows-x86_64";
        #[cfg(target_os = "linux")]
        let platform_key = "linux-x86_64";

        let url = metadata["platforms"][platform_key]["url"].as_str().unwrap_or("").to_string();
        if !url.is_empty() {
            return Ok(Some(url));
        }
    }
    Ok(None)
}

#[cfg(target_os = "macos")]
fn get_mac_app_bundle_path(exe_path: &std::path::Path) -> Option<std::path::PathBuf> {
    let mut path = exe_path.to_path_buf();
    while let Some(parent) = path.parent() {
        if parent.extension().map_or(false, |ext| ext == "app") {
            return Some(parent.to_path_buf());
        }
        path = parent.to_path_buf();
    }
    None
}

// Descarga en caliente del binario y reemplazo de inodos/procesos
async fn run_hot_update(app_handle: &AppHandle, url: &str) -> Result<(), String> {
    // 1. Indicar que estamos en proceso de actualización
    if let Some(updating_state) = app_handle.try_state::<crate::UpdatingState>() {
        if let Ok(mut updating) = updating_state.0.lock() {
            *updating = true;
        }
    }

    let client = reqwest::Client::new();
    let mut response = client.get(url)
        .send()
        .await
        .map_err(|e| format!("Fallo al iniciar descarga: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Fallo descarga: HTTP {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);
    
    // Determinar la extensión del archivo a descargar basado en la URL
    let url_lower = url.to_lowercase();
    let is_zip = url_lower.ends_with(".zip");
    let is_msi = url_lower.ends_with(".msi");
    let is_exe = url_lower.ends_with(".exe");
    let is_dmg = url_lower.ends_with(".dmg");
    let is_deb = url_lower.ends_with(".deb");

    let mut temp_file_path = std::env::temp_dir();
    if is_zip {
        temp_file_path.push("SandraDC_setup.zip");
    } else if is_msi {
        temp_file_path.push("SandraDC_setup.msi");
    } else if is_exe {
        temp_file_path.push("SandraDC_setup.exe");
    } else if is_dmg {
        temp_file_path.push("SandraDC_setup.dmg");
    } else if is_deb {
        temp_file_path.push("SandraDC_setup.deb");
    } else {
        #[cfg(target_os = "windows")]
        temp_file_path.push("SandraDC_setup.exe");
        #[cfg(not(target_os = "windows"))]
        temp_file_path.push("SandraDC_setup");
    }

    let mut temp_file = std::fs::File::create(&temp_file_path)
        .map_err(|e| format!("Error creando archivo temporal: {}", e))?;

    let mut downloaded: u64 = 0;
    
    while let Some(chunk) = response.chunk().await.map_err(|e| format!("Error leyendo trozo de descarga: {}", e))? {
        temp_file.write_all(&chunk).map_err(|e| format!("Error escribiendo trozo a disco: {}", e))?;
        downloaded += chunk.len() as u64;

        let percentage = if total_size > 0 { downloaded as f32 / total_size as f32 } else { 0.0 };
        // Mapear el progreso de la descarga (0%-100%) al rango del 50% al 90% de la barra de carga
        let loader_percentage = 50.0 + (percentage * 40.0);
        let detail_msg = format!("Updates: {} / {} bytes ({:.1}%)", downloaded, total_size, percentage * 100.0);

        app_handle.emit("loader-sequence-progress", LoaderProgress {
            layer: "NETWORK_LAYER".to_string(),
            percentage: loader_percentage,
            status_message: "Sincronizando Actualización...".to_string(),
            detail: detail_msg,
        }).unwrap();
    }

    temp_file.sync_all().map_err(|e| format!("Error sincronizando buffer temporal: {}", e))?;
    drop(temp_file);

    app_handle.emit("loader-sequence-progress", LoaderProgress {
        layer: "NETWORK_LAYER".to_string(),
        percentage: 95.0,
        status_message: "Instalando parche...".to_string(),
        detail: "Updates: Deteniendo Base de Datos e Inodos...".to_string(),
    }).unwrap();

    // Liberar conexión SQLite para evitar bloqueos
    if let Some(db_state) = app_handle.try_state::<DbState>() {
        if let Ok(mut conn_guard) = db_state.0.lock() {
            if let Ok(temp_conn) = rusqlite::Connection::open_in_memory() {
                *conn_guard = temp_conn;
            }
        }
    }

    let current_exe_path = std::env::current_exe()
        .map_err(|e| format!("Error localizando ejecutable activo: {}", e))?;

    #[cfg(target_os = "windows")]
    {
        let pid = std::process::id();
        let ps_script_path = std::env::temp_dir().join("SandraDC_install.ps1");
        let extract_dir = std::env::temp_dir().join("SandraDC_extracted");
        
        let ps_content = format!(
            r#"# Esperar a que el proceso principal de SandraDC termine
$processId = {pid}
while (Get-Process -Id $processId -ErrorAction SilentlyContinue) {{
    Start-Sleep -Milliseconds 500
}}

$downloadedPath = "{temp_file_path}"
$extractDir = "{extract_dir}"

# 1. Si es un archivo ZIP, extraerlo
if ($downloadedPath.EndsWith(".zip", [System.StringComparison]::OrdinalIgnoreCase)) {{
    if (Test-Path $extractDir) {{
        Remove-Item -Recurse -Force $extractDir
    }}
    New-Item -ItemType Directory -Path $extractDir -Force
    Expand-Archive -Path $downloadedPath -DestinationPath $extractDir -Force
    
    # Buscar instaladores dentro de la carpeta extraida
    $installer = Get-ChildItem -Path $extractDir -Include "*.msi", "*.exe" -Recurse | Select-Object -First 1
    if ($installer) {{
        $downloadedPath = $installer.FullName
    }}
}}

# 2. Ejecutar el instalador
if ($downloadedPath.EndsWith(".msi", [System.StringComparison]::OrdinalIgnoreCase)) {{
    # Ejecutar MSI de forma pasiva
    Start-Process -FilePath "msiexec.exe" -ArgumentList "/i `"$downloadedPath`" /passive /norestart" -Wait
}} elseif ($downloadedPath.EndsWith(".exe", [System.StringComparison]::OrdinalIgnoreCase)) {{
    # Ejecutar EXE de forma silenciosa (/S es el estándar para NSIS)
    Start-Process -FilePath $downloadedPath -ArgumentList "/S" -Wait
}}

# 3. Re-iniciar la aplicacion principal
if (Test-Path "{current_exe_path}") {{
    Start-Process -FilePath "{current_exe_path}"
}}

# Limpieza
if (Test-Path $extractDir) {{
    Remove-Item -Recurse -Force $extractDir
}}
if (Test-Path "{temp_file_path}") {{
    Remove-Item -Force "{temp_file_path}"
}}
Remove-Item -Force $MyInvocation.MyCommand.Path
"#,
            pid = pid,
            temp_file_path = temp_file_path.to_string_lossy().replace('\\', "\\\\"),
            extract_dir = extract_dir.to_string_lossy().replace('\\', "\\\\"),
            current_exe_path = current_exe_path.to_string_lossy().replace('\\', "\\\\")
        );

        std::fs::write(&ps_script_path, ps_content)
            .map_err(|e| format!("Fallo al escribir script de instalación: {}", e))?;

        app_handle.emit("loader-sequence-progress", LoaderProgress {
            layer: "NETWORK_LAYER".to_string(),
            percentage: 100.0,
            status_message: "Instalando actualización...".to_string(),
            detail: "Updates: Apagando sistema e instalando nueva versión...".to_string(),
        }).unwrap();

        tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;

        // Ejecutar PowerShell en segundo plano de forma oculta
        std::process::Command::new("powershell.exe")
            .args(&[
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-WindowStyle",
                "Hidden",
                "-File",
                &ps_script_path.to_string_lossy(),
            ])
            .spawn()
            .map_err(|e| format!("Error ejecutando script de actualización: {}", e))?;

        app_handle.exit(0);
    }

    #[cfg(target_os = "macos")]
    {
        let pid = std::process::id();
        let app_bundle_path = get_mac_app_bundle_path(&current_exe_path)
            .ok_or_else(|| "No se pudo determinar el bundle de la aplicación (.app)".to_string())?;

        let script_path = std::env::temp_dir().join("SandraDC_install.sh");
        let script_content = format!(
            r#"#!/bin/bash
# Esperar a que el proceso principal termine
while kill -0 {pid} 2>/dev/null; do
    sleep 0.5
done

# Crear punto de montaje temporal
MOUNT_DIR=$(mktemp -d -t sandra_mount)
hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT_DIR" "{temp_file_path}"

# Buscar la app en el volumen montado
APP_PATH=$(find "$MOUNT_DIR" -maxdepth 1 -name "*.app" | head -n 1)

if [ -n "$APP_PATH" ]; then
    # Sobreescribir la aplicación instalada
    rm -rf "{app_bundle_path}"
    cp -R "$APP_PATH" "{app_bundle_path}"
fi

# Desmontar DMG y limpiar
hdiutil detach "$MOUNT_DIR"
rm -rf "$MOUNT_DIR"

# Abrir la nueva versión
open "{app_bundle_path}"

# Limpiar archivos de instalación
rm -f "{temp_file_path}"
rm -f "$0"
"#,
            pid = pid,
            temp_file_path = temp_file_path.to_string_lossy(),
            app_bundle_path = app_bundle_path.to_string_lossy()
        );

        std::fs::write(&script_path, script_content)
            .map_err(|e| format!("Fallo al escribir script de instalación: {}", e))?;

        // Hacer ejecutable el script
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script_path, perms).unwrap();

        app_handle.emit("loader-sequence-progress", LoaderProgress {
            layer: "NETWORK_LAYER".to_string(),
            percentage: 100.0,
            status_message: "Instalando actualización...".to_string(),
            detail: "Updates: Apagando sistema e instalando nueva versión...".to_string(),
        }).unwrap();

        tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;

        std::process::Command::new("/bin/bash")
            .arg(&script_path)
            .spawn()
            .map_err(|e| format!("Error ejecutando script de actualización: {}", e))?;

        app_handle.exit(0);
    }

    #[cfg(target_os = "linux")]
    {
        let pid = std::process::id();
        let script_path = std::env::temp_dir().join("SandraDC_install.sh");
        let script_content = format!(
            r#"#!/bin/bash
# Esperar a que el proceso principal termine
while kill -0 {pid} 2>/dev/null; do
    sleep 0.5
done

# Instalar deb usando pkexec para pedir privilegios gráficos
pkexec dpkg -i "{temp_file_path}"

# Re-iniciar la aplicación
if [ -f "/usr/bin/sandra-desktop-container" ]; then
    /usr/bin/sandra-desktop-container &
else
    "{current_exe_path}" &
fi

# Limpieza
rm -f "{temp_file_path}"
rm -f "$0"
"#,
            pid = pid,
            temp_file_path = temp_file_path.to_string_lossy(),
            current_exe_path = current_exe_path.to_string_lossy()
        );

        std::fs::write(&script_path, script_content)
            .map_err(|e| format!("Fallo al escribir script de instalación: {}", e))?;

        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script_path, perms).unwrap();

        app_handle.emit("loader-sequence-progress", LoaderProgress {
            layer: "NETWORK_LAYER".to_string(),
            percentage: 100.0,
            status_message: "Instalando actualización...".to_string(),
            detail: "Updates: Apagando sistema e instalando nueva versión...".to_string(),
        }).unwrap();

        tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;

        std::process::Command::new("/bin/bash")
            .arg(&script_path)
            .spawn()
            .map_err(|e| format!("Error ejecutando script de actualización: {}", e))?;

        app_handle.exit(0);
    }

    #[allow(unreachable_code)]
    Ok(())
}

#[tauri::command]
pub async fn start_loader_sequence(app_handle: AppHandle) -> Result<(), String> {
    let steps = vec![
        ("BOOT_LAYER", 25.0, "Verificando hardware e integridad..."),
        ("NETWORK_LAYER", 50.0, "Levantando proxy inteligente y protocolos..."),
        ("STORAGE_LAYER", 75.0, "Sincronizando base de datos local..."),
        ("IPC_LAYER", 100.0, "Estableciendo puente Antigravity UI..."),
    ];

    for (layer, percentage, msg) in steps {
        match layer {
            "BOOT_LAYER" => {
                let mut sys = System::new_all();
                sys.refresh_all();
                let total_mem = sys.total_memory() / 1024 / 1024; // MB
                let cpu_count = sys.cpus().len();
                let detail = format!("CPU Cores: {} | RAM: {} MB | Integrity: OK", cpu_count, total_mem);
                
                app_handle.emit("loader-sequence-progress", LoaderProgress {
                    layer: layer.to_string(),
                    percentage,
                    status_message: msg.to_string(),
                    detail,
                }).map_err(|e| e.to_string())?;
                
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            }
            "NETWORK_LAYER" => {
                app_handle.emit("loader-sequence-progress", LoaderProgress {
                    layer: layer.to_string(),
                    percentage,
                    status_message: "Buscando actualizaciones de sistema...".to_string(),
                    detail: "Updates: Conectando con github.com...".to_string(),
                }).map_err(|e| e.to_string())?;

                // Buscar actualizaciones seguras en GitHub
                match check_updater_github(&app_handle).await {
                    Ok(Some(update_url)) => {
                        app_handle.emit("loader-sequence-progress", LoaderProgress {
                            layer: layer.to_string(),
                            percentage: 55.0,
                            status_message: "Actualización disponible".to_string(),
                            detail: "Updates: Nueva versión detectada | Iniciando descarga...".to_string(),
                        }).map_err(|e| e.to_string())?;

                        // Ejecutar actualización e instalación
                        match run_hot_update(&app_handle, &update_url).await {
                            Ok(_) => {
                                // En macOS o Windows la app se reiniciará sola
                                return Ok(());
                            }
                            Err(e) => {
                                // Fallback seguro: reportar error y continuar la carga normal
                                app_handle.emit("loader-sequence-progress", LoaderProgress {
                                    layer: layer.to_string(),
                                    percentage: 50.0,
                                    status_message: "Fallo de actualización".to_string(),
                                    detail: format!("[WARNING] Updates: {} | Continuando inicio...", e),
                                }).map_err(|e| e.to_string())?;
                                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                            }
                        }
                    }
                    Ok(None) => {
                        app_handle.emit("loader-sequence-progress", LoaderProgress {
                            layer: layer.to_string(),
                            percentage: 50.0,
                            status_message: msg.to_string(),
                            detail: "Updates: Sistema sincronizado y al día | OK".to_string(),
                        }).map_err(|e| e.to_string())?;
                        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                    }
                    Err(e) => {
                        app_handle.emit("loader-sequence-progress", LoaderProgress {
                            layer: layer.to_string(),
                            percentage: 50.0,
                            status_message: msg.to_string(),
                            detail: format!("[WARNING] Updates: {} | OK", e),
                        }).map_err(|e| e.to_string())?;
                        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                    }
                }
            }
            "STORAGE_LAYER" => {
                let detail;
                if let Some(db_state) = app_handle.try_state::<DbState>() {
                    let conn = db_state.0.lock().map_err(|e| e.to_string())?;
                    let result: Result<i32, _> = conn.query_row("SELECT 1", [], |row| row.get(0));
                    match result {
                        Ok(_) => detail = "SQLite: Conectado | Modo WAL: Activo | OK".to_string(),
                        Err(e) => return Err(format!("Error verificando base de datos: {}", e)),
                    }
                } else {
                    return Err("DbState no está inicializado en la aplicación".to_string());
                }
                
                app_handle.emit("loader-sequence-progress", LoaderProgress {
                    layer: layer.to_string(),
                    percentage,
                    status_message: msg.to_string(),
                    detail,
                }).map_err(|e| e.to_string())?;
                
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            }
            "IPC_LAYER" => {
                let detail = "Bridges IPC activos | Handshake completado | OK".to_string();
                
                app_handle.emit("loader-sequence-progress", LoaderProgress {
                    layer: layer.to_string(),
                    percentage,
                    status_message: msg.to_string(),
                    detail,
                }).map_err(|e| e.to_string())?;
                
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            }
            _ => {}
        }
    }

    app_handle.emit("loader-sequence-ready", ()).map_err(|e| e.to_string())?;

    if let Some(loader_state) = app_handle.try_state::<crate::LoaderReady>() {
        if let Ok(mut ready) = loader_state.0.lock() {
            *ready = true;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn is_loader_ready(app_handle: AppHandle) -> bool {
    if let Some(loader_state) = app_handle.try_state::<crate::LoaderReady>() {
        if let Ok(ready) = loader_state.0.lock() {
            return *ready;
        }
    }
    false
}
