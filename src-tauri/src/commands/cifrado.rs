use crate::crypto;
use crate::sha256::Sha256Service;
use crate::storage::DbState;
use chrono::Local;
use rand::{distr::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use tauri::{command, State};

#[derive(Serialize)]
pub struct SecureResponse {
    pub authorization_id: String,
    pub data_encrypted: String,
    pub status: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct HighSecurity {
    pub auth_id: String,
    pub key: String,
    pub user: String,
    pub tiempo: String,
}

#[command]
pub async fn aplicar_capa_seguridad(
    state: State<'_, DbState>,
    data: String,
    user: String,
) -> Result<SecureResponse, String> {
    // 1. Generar auth_id (Hash del contenido + timestamp para unicidad)
    let time_now = Local::now();
    let time_str = time_now.format("%Y-%m-%d %H:%M:%S").to_string();
    let auth_id = Sha256Service::hash(&format!("{}{}", data, time_now.to_rfc3339()));

    // 2. Generamos una cadena alfanumérica de 32 caracteres (Key segura)
    let key: String = rand::rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();

    // 3. Ciframos los datos usando AES con la llave generada
    let encrypted = crypto::encrypt_string(&data, &key)
        .map_err(|e| format!("Error al cifrar capa de seguridad: {}", e))?;

    // 4. Guardamos en la base de datos (equivalente a InsertNOSQL en Go)
    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO high_security (auth_id, key, user, tiempo) VALUES (?1, ?2, ?3, ?4)",
            (&auth_id, &key, &user, &time_str),
        )
        .map_err(|e| format!("Error persistiendo capa de seguridad: {}", e))?;
    }

    // 5. Retornamos la respuesta segura con estado LOCKED
    Ok(SecureResponse {
        authorization_id: auth_id,
        data_encrypted: encrypted,
        status: "LOCKED".to_string(),
    })
}

#[command]
pub async fn remover_capa_seguridad(
    state: State<'_, DbState>,
    auth_id: String,
    data_encrypted: String,
) -> Result<String, String> {
    // 1. Buscamos la llave asociada al authorization_id en la base de datos
    let key: String = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT key FROM high_security WHERE auth_id = ?1",
            [&auth_id],
            |row| row.get(0),
        )
        .map_err(|_| "Autorización inválida, llave no encontrada o expirada".to_string())?
    };

    // 2. Desencriptamos los datos usando la llave recuperada
    let decrypted = crypto::decrypt_string(&data_encrypted, &key)
        .map_err(|e| format!("Error al remover capa de seguridad: {}", e))?;

    Ok(decrypted)
}
