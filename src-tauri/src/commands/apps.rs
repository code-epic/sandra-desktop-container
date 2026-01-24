use std::fs;

use tauri::Manager;


#[tauri::command]
pub async fn download_app_repo(app_handle: tauri::AppHandle, repo_url: String, folder_name: String) -> Result<(), String> {
    let app_data = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let target_dir = app_data.join("apps").join(&folder_name);

    if target_dir.exists() {
        return Err("La aplicación ya está instalada. Intenta actualizarla.".into());
    }

    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;

    // Ejecutamos git clone. El repo DEBE tener la carpeta dist ya compilada.
    let status = std::process::Command::new("git")
        .args(["clone", "--depth", "1", &repo_url, "."])
        .current_dir(&target_dir)
        .status()
        .map_err(|e| format!("Error al ejecutar git: {}", e))?;

    if status.success() {
        Ok(())
    } else {
        Err("Error al clonar el repositorio".into())
    }
}


#[tauri::command]
pub async fn update_app_repo(app_handle: tauri::AppHandle, folder_name: String) -> Result<(), String> {
    let app_data = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let target_dir = app_data.join("apps").join(&folder_name);

    if !target_dir.exists() {
        return Err("La aplicación no está instalada.".into());
    }

    // Ejecutamos git pull para actualizar
    let status = std::process::Command::new("git")
        .arg("pull")
        .current_dir(&target_dir)
        .status()
        .map_err(|e| format!("Error al ejecutar git pull: {}", e))?;

    if status.success() {
        Ok(())
    } else {
        Err("Error al actualizar el repositorio".into())
    }
}

#[tauri::command]
pub async fn delete_app_repo(app_handle: tauri::AppHandle, folder_name: String) -> Result<(), String> {
    let app_data = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let target_dir = app_data.join("apps").join(&folder_name);

    if !target_dir.exists() {
        return Err("La aplicación no existe.".into());
    }

    fs::remove_dir_all(&target_dir).map_err(|e| format!("Error al eliminar la carpeta: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn open_app_window(app_handle: tauri::AppHandle, folder_name: String) -> Result<(), String> {
    let window_label = format!("app-{}", folder_name);
    
    // Ahora solo apuntamos a la carpeta de la app. 
    // El protocolo se encarga de entrar a /dist/index.html automáticamente.
    let url = format!("sandra-app://localhost/{}/", folder_name);

    tauri::WebviewWindowBuilder::new(
        &app_handle,
        &window_label,
        tauri::WebviewUrl::App(url.parse().unwrap())
    )
    .title(format!("Sandra App: {}", folder_name))
    .inner_size(1200.0, 800.0)
    // Importante: Habilitar que la ventana hija pueda usar comandos de Tauri si es necesario
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn verify_app_installed(app_handle: tauri::AppHandle, folder_name: String) -> Result<bool, String> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = app_dir.join("apps").join(&folder_name).join("dist").join("index.html");
    
    Ok(path.exists())
}