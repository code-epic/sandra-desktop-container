use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use openpgp::parse::{stream::*, Parse};
use openpgp::policy::StandardPolicy;
use openpgp::serialize::stream::Message;
use sequoia_openpgp as openpgp;
use std::io::Write;
use tauri::command;

// --- GPG Core Logic ---

pub fn encrypt_symmetric(plaintext: &[u8], password: &str) -> anyhow::Result<Vec<u8>> {
    let mut sink = Vec::new();
    {
        let message = Message::new(&mut sink);
        let encryptor = openpgp::serialize::stream::Encryptor2::with_passwords(
            message,
            vec![openpgp::crypto::Password::from(password)],
        )
        .build()?;
        let mut literal = openpgp::serialize::stream::LiteralWriter::new(encryptor).build()?;
        literal.write_all(plaintext)?;
        literal.finalize()?;
    }
    Ok(sink)
}

struct SymmetricHelper<'a> {
    password: &'a str,
}

impl<'a> VerificationHelper for SymmetricHelper<'a> {
    fn get_certs(&mut self, _ids: &[openpgp::KeyHandle]) -> openpgp::Result<Vec<openpgp::Cert>> {
        Ok(Vec::new())
    }
    fn check(&mut self, _structure: MessageStructure) -> openpgp::Result<()> {
        Ok(())
    }
}

impl<'a> DecryptionHelper for SymmetricHelper<'a> {
    fn decrypt<D>(
        &mut self,
        _pkesks: &[openpgp::packet::PKESK],
        skesks: &[openpgp::packet::SKESK],
        _sym_algo: Option<openpgp::types::SymmetricAlgorithm>,
        mut decrypt: D,
    ) -> openpgp::Result<Option<openpgp::Fingerprint>>
    where
        D: FnMut(openpgp::types::SymmetricAlgorithm, &openpgp::crypto::SessionKey) -> bool,
    {
        for skesk in skesks {
            let password = openpgp::crypto::Password::from(self.password);
            if let Ok((algo, session_key)) = skesk.decrypt(&password) {
                if decrypt(algo, &session_key) {
                    return Ok(None);
                }
            }
        }
        Err(anyhow::anyhow!("Contraseña incorrecta o archivo inválido").into())
    }
}

pub fn decrypt_symmetric(ciphertext: &[u8], password: &str) -> anyhow::Result<Vec<u8>> {
    let policy = StandardPolicy::new();
    let helper = SymmetricHelper { password };
    let mut decryptor =
        DecryptorBuilder::from_bytes(ciphertext)?.with_policy(&policy, None, helper)?;

    let mut plaintext = Vec::new();
    std::io::copy(&mut decryptor, &mut plaintext)?;
    Ok(plaintext)
}

// --- Tauri Commands ---

#[command]
pub async fn encrypt_gpg_symmetric_base64(
    base64_input: String,
    passphrase: String,
) -> Result<String, String> {
    let prefix = "data:application/pdf;base64,";
    let input_clean = if base64_input.starts_with(prefix) {
        base64_input.trim_start_matches(prefix)
    } else {
        &base64_input
    };

    let decoded = BASE64.decode(input_clean).map_err(|e| e.to_string())?;

    let encrypted = encrypt_symmetric(&decoded, &passphrase)
        .map_err(|e| format!("Error cifrando GPG: {}", e))?;

    Ok(BASE64.encode(encrypted))
}

#[command]
pub async fn decrypt_gpg_symmetric_file(
    file_path: String,
    passphrase: String,
) -> Result<String, String> {
    let encrypted =
        std::fs::read(&file_path).map_err(|e| format!("Error leyendo archivo GPG: {}", e))?;

    let plaintext = decrypt_symmetric(&encrypted, &passphrase)
        .map_err(|e| format!("Error descifrando GPG: {:?}", e))?;

    Ok(BASE64.encode(plaintext))
}
