use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose, Engine as _};
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde_json::Value;
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

pub struct Sha256Service;

impl Sha256Service {
    /// Computa el hash SHA-256 de un mensaje.
    /// Esta implementación utiliza la crate 'sha2' para mayor seguridad y rendimiento,
    /// equivalente a la implementación manual proporcionada en TypeScript.
    pub fn hash(message: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(message.as_bytes());
        let result = hasher.finalize();
        format!("{:x}", result)
    }

    /// Computa el HMAC-SHA256 de un mensaje con una clave.
    pub fn hmac(message: &str, key: &str) -> Result<String, String> {
        let mut mac: HmacSha256 = Mac::new_from_slice(key.as_bytes())
            .map_err(|e| format!("Error al inicializar HMAC: {}", e))?;
        mac.update(message.as_bytes());
        let result = mac.finalize();
        let code_bytes = result.into_bytes();
        Ok(code_bytes.iter().map(|b| format!("{:02x}", b)).collect())
    }

    /// Cifra el contexto del dispositivo usando AES-256-GCM.
    /// Formato de salida: Base64(IV + Ciphertext + Tag)
    pub fn encrypt_device_context(context: &Value, secret_key: &str) -> Result<String, String> {
        let data = serde_json::to_string(context)
            .map_err(|e| format!("Error al serializar contexto: {}", e))?;

        // La clave debe ser de 32 bytes para AES-256
        let mut key_bytes = [0u8; 32];
        let secret_bytes = secret_key.as_bytes();
        let len = secret_bytes.len().min(32);
        key_bytes[..len].copy_from_slice(&secret_bytes[..len]);

        let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
        let cipher = Aes256Gcm::new(key);

        // Generar IV de 12 bytes
        let mut iv = [0u8; 12];
        rand::rng().fill_bytes(&mut iv);
        let nonce = Nonce::from_slice(&iv);

        // Cifrar (Tag se añade automáticamente al final por la crate aes-gcm)
        let encrypted = cipher
            .encrypt(nonce, data.as_bytes())
            .map_err(|e| format!("Error en cifrado AES-GCM: {}", e))?;

        // Combinar IV + Datos Cifrados
        let mut combined = Vec::with_capacity(iv.len() + encrypted.len());
        combined.extend_from_slice(&iv);
        combined.extend_from_slice(&encrypted);

        Ok(general_purpose::STANDARD.encode(combined))
    }
}
