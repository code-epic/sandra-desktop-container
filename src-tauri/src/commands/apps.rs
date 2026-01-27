use crate::storage::DbState;
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::Manager;

#[tauri::command]
pub async fn download_app_repo(
    app_handle: tauri::AppHandle,
    repo_url: String,
    folder_name: String,
) -> Result<(), String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
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
pub async fn update_app_repo(
    app_handle: tauri::AppHandle,
    folder_name: String,
) -> Result<(), String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
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
pub async fn delete_app_repo(
    app_handle: tauri::AppHandle,
    folder_name: String,
) -> Result<(), String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let target_dir = app_data.join("apps").join(&folder_name);

    if !target_dir.exists() {
        return Err("La aplicación no existe.".into());
    }

    fs::remove_dir_all(&target_dir).map_err(|e| format!("Error al eliminar la carpeta: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn open_app_window(
    app_handle: tauri::AppHandle,
    folder_name: String,
) -> Result<(), String> {
    let window_label = format!("app-{}", folder_name);

    // Ahora solo apuntamos a la carpeta de la app.
    // El protocolo se encarga de entrar a /dist/index.html automáticamente.
    let url = format!("sandra-app://localhost/{}/", folder_name);

    tauri::WebviewWindowBuilder::new(
        &app_handle,
        &window_label,
        tauri::WebviewUrl::App(url.parse().unwrap()),
    )
    .title(format!("Sandra App: {}", folder_name))
    .inner_size(1200.0, 800.0)
    // Importante: Habilitar que la ventana hija pueda usar comandos de Tauri si es necesario
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DesktopApp {
    pub id: Option<i32>,
    pub app_id: String,
    pub name: String,
    pub icon: String,
    pub repo: Option<String>,
    pub external_url: Option<String>,
    pub is_installed: bool,
    pub is_favorite: bool,
    pub description: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub token: Option<String>,
}

#[tauri::command]
pub async fn get_all_apps(state: tauri::State<'_, DbState>) -> Result<Vec<DesktopApp>, String> {
    let conn = state.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, app_id, name, icon, repo, external_url, is_installed, is_favorite, description, username, password, token FROM desktop_apps ORDER BY name ASC")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(DesktopApp {
                id: Some(row.get(0)?),
                app_id: row.get(1)?,
                name: row.get(2)?,
                icon: row.get(3)?,
                repo: row.get(4)?,
                external_url: row.get(5)?,
                is_installed: row.get(6)?,
                is_favorite: row.get(7)?,
                description: row.get(8).unwrap_or(None),
                username: row.get(9).unwrap_or(None),
                password: row.get(10).unwrap_or(None),
                token: row.get(11).unwrap_or(None),
            })
        })
        .map_err(|e| e.to_string())?;

    let mut apps = Vec::new();
    for row in rows {
        apps.push(row.map_err(|e| e.to_string())?);
    }

    Ok(apps)
}

#[tauri::command]
pub async fn create_app(state: tauri::State<'_, DbState>, app: DesktopApp) -> Result<i64, String> {
    let conn = state.0.lock().unwrap();
    conn.execute(
        "INSERT INTO desktop_apps (app_id, name, icon, repo, external_url, is_installed, is_favorite, description, username, password, token) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        (
            &app.app_id,
            &app.name,
            &app.icon,
            &app.repo,
            &app.external_url,
            &app.is_installed,
            &app.is_favorite,
            &app.description,
            &app.username,
            &app.password,
            &app.token,
        ),
    )
    .map_err(|e| e.to_string())?;

    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub async fn update_app(state: tauri::State<'_, DbState>, app: DesktopApp) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    conn.execute(
        "UPDATE desktop_apps SET name = ?1, icon = ?2, repo = ?3, external_url = ?4, is_installed = ?5, is_favorite = ?6, description = ?7, username = ?8, password = ?9, token = ?10 WHERE app_id = ?11",
        (
            &app.name,
            &app.icon,
            &app.repo,
            &app.external_url,
            &app.is_installed,
            &app.is_favorite,
            &app.description,
            &app.username,
            &app.password,
            &app.token,
            &app.app_id,
        ),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_app(state: tauri::State<'_, DbState>, app_id: String) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    conn.execute("DELETE FROM desktop_apps WHERE app_id = ?1", [&app_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn verify_app_installed(
    app_handle: tauri::AppHandle,
    folder_name: String,
) -> Result<bool, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let path = app_dir
        .join("apps")
        .join(&folder_name)
        .join("dist")
        .join("index.html");

    Ok(path.exists())
}
