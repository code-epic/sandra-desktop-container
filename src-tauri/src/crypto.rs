use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use argon2::{
    password_hash::{PasswordHasher, SaltString},
    Argon2,
};
use base64::{engine::general_purpose, Engine as _};
use rand::RngCore;

pub const PACKAGE_SALT: &str = "SANDRA_SECURE_CHANNEL_V1";

/// Deriva una clave de 32 bytes a partir de una semilla (MAC, Device Secret, etc)
/// usando Argon2id para máxima seguridad "military grade".
pub fn derive_32byte_key(seed: &str) -> Result<[u8; 32], String> {
    let salt = SaltString::encode_b64(PACKAGE_SALT.as_bytes()).map_err(|e| e.to_string())?;
    let argon2 = Argon2::default();

    let password_hash = argon2
        .hash_password(seed.as_bytes(), &salt)
        .map_err(|e| e.to_string())?;

    let hash_bytes = password_hash
        .hash
        .ok_or("Argon2 hashing failed to produce output")?;

    let mut key = [0u8; 32];
    let hash_str = hash_bytes.as_bytes();
    if hash_str.len() >= 32 {
        key.copy_from_slice(&hash_str[..32]);
    } else {
        return Err("Derived key length insufficient".into());
    }

    Ok(key)
}

fn get_key_from_bytes(bytes: &[u8]) -> Result<Key<Aes256Gcm>, String> {
    if bytes.len() != 32 {
        return Err(format!(
            "Key must be exactly 32 bytes for AES-256-GCM. Got {}",
            bytes.len()
        ));
    }
    Ok(*Key::<Aes256Gcm>::from_slice(bytes))
}

// --- Operaciones Binarias (Raw) ---

pub fn encrypt_raw(data: &[u8], key_bytes: &[u8]) -> Result<Vec<u8>, String> {
    let key = get_key_from_bytes(key_bytes)?;
    let cipher = Aes256Gcm::new(&key);

    let mut nonce_bytes = [0u8; 12];
    rand::rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, data)
        .map_err(|e| format!("Encryption failure: {}", e))?;

    let mut combined = Vec::new();
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);
    Ok(combined)
}

pub fn decrypt_raw(encrypted_data: &[u8], key_bytes: &[u8]) -> Result<Vec<u8>, String> {
    let key = get_key_from_bytes(key_bytes)?;
    let cipher = Aes256Gcm::new(&key);

    if encrypted_data.len() < 12 {
        return Err("Invalid data length (too short for IV)".to_string());
    }

    let (iv_bytes, ciphertext_bytes) = encrypted_data.split_at(12);
    let nonce = Nonce::from_slice(iv_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext_bytes)
        .map_err(|e| format!("Decryption failure: {}", e))?;

    Ok(plaintext)
}

// --- Operaciones String (Base64) ---

pub fn encrypt_string(data: &str, secret_key: &str) -> Result<String, String> {
    // Si secret_key no tiene 32 bytes, intentamos derivarla para compatibilidad
    let key_bytes = if secret_key.len() == 32 {
        let mut b = [0u8; 32];
        b.copy_from_slice(secret_key.as_bytes());
        b
    } else {
        derive_32byte_key(secret_key)?
    };

    let encrypted = encrypt_raw(data.as_bytes(), &key_bytes)?;
    Ok(general_purpose::STANDARD.encode(encrypted))
}

pub fn decrypt_string(encrypted_base64: &str, secret_key: &str) -> Result<String, String> {
    let key_bytes = if secret_key.len() == 32 {
        let mut b = [0u8; 32];
        b.copy_from_slice(secret_key.as_bytes());
        b
    } else {
        derive_32byte_key(secret_key)?
    };

    let encrypted_data = general_purpose::STANDARD
        .decode(encrypted_base64)
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    let plaintext = decrypt_raw(&encrypted_data, &key_bytes)?;
    String::from_utf8(plaintext).map_err(|e| format!("UTF-8 conversion error: {}", e))
}
