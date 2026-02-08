use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose, Engine as _};
use rand::RngCore; // RngCore required for fill_bytes
use std::str; // Import struct if needed, or pass as String

/// Asegura que la clave tenga 32 bytes (Hash SHA256 o padding).
/// Para compatibilidad estricta con tu ejemplo Angular "raw", esta función asume que
/// el string de entrada YA tiene 32 caracteres (bytes) o implementas un hash previo.
/// Aquí uso un hash simple (o slice) para seguridad si el input varía.
/// PERO, para tu ejemplo exacto "raw import", usamos los bytes directos.
fn get_key_bytes(secret: &str) -> Result<Key<Aes256Gcm>, String> {
    if secret.len() != 32 {
        return Err(format!(
            "Secret key must be exactly 32 bytes (chars) for AES-256-GCM. Got {}",
            secret.len()
        ));
    }
    Ok(*Key::<Aes256Gcm>::from_slice(secret.as_bytes()))
}

pub fn encrypt_string(data: &str, secret_key: &str) -> Result<String, String> {
    let key = get_key_bytes(secret_key)?;
    let cipher = Aes256Gcm::new(&key);

    // Generar IV (Nonce) de 96-bits (12 bytes) - Estándar GCM
    let mut nonce_bytes = [0u8; 12];
    rand::rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Cifrar
    let ciphertext = cipher
        .encrypt(nonce, data.as_bytes())
        .map_err(|e| format!("Encryption failure: {}", e))?;

    // Concatenar: IV + Ciphertext (Tag está incluido al final del ciphertext por aes-gcm crate)
    // Nota: WebCrypto también tiende a poner el Tag al final del ciphertext.
    let mut combined = Vec::new();
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);

    // Base64 Encode
    Ok(general_purpose::STANDARD.encode(combined))
}

pub fn decrypt_string(encrypted_base64: &str, secret_key: &str) -> Result<String, String> {
    let key = get_key_bytes(secret_key)?;
    let cipher = Aes256Gcm::new(&key);

    // Decodificar Base64
    let combined = general_purpose::STANDARD
        .decode(encrypted_base64)
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    if combined.len() < 12 {
        return Err("Invalid data length (too short for IV)".to_string());
    }

    // Extraer IV y Ciphertext
    let (iv_bytes, ciphertext_bytes) = combined.split_at(12);
    let nonce = Nonce::from_slice(iv_bytes);

    // Descifrar
    let plaintext_bytes = cipher
        .decrypt(nonce, ciphertext_bytes)
        .map_err(|e| format!("Decryption failure (mac check failed?): {}", e))?;

    // Convertir a String
    String::from_utf8(plaintext_bytes).map_err(|e| format!("UTF-8 conversion error: {}", e))
}
