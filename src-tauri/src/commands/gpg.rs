use openpgp::parse::{stream::*, Parse};
use openpgp::policy::StandardPolicy;
use openpgp::serialize::stream::Message;
use sequoia_openpgp as openpgp;
use std::fs::File;
use std::io::{BufReader, Cursor, Read, Write};
use tauri::command;

pub fn encrypt_symmetric_stream<R: Read + Send + Sync, W: Write + Send + Sync>(
    mut source: R,
    sink: W,
    password: &str,
) -> anyhow::Result<()> {
    let message = Message::new(sink);
    let encryptor = openpgp::serialize::stream::Encryptor2::with_passwords(
        message,
        vec![openpgp::crypto::Password::from(password)],
    )
    .build()?;

    let compressor = openpgp::serialize::stream::Compressor::new(encryptor)
        .algo(openpgp::types::CompressionAlgorithm::Uncompressed)
        .build()?;

    let mut literal = openpgp::serialize::stream::LiteralWriter::new(compressor).build()?;
    std::io::copy(&mut source, &mut literal)?;
    literal.finalize()?;
    Ok(())
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

pub fn decrypt_symmetric_stream<R: Read + Send + Sync, W: Write + Send + Sync>(
    mut source: R,
    mut sink: W,
    password: &str,
) -> anyhow::Result<()> {
    let policy = StandardPolicy::new();
    let helper = SymmetricHelper { password };
    let mut decryptor =
        DecryptorBuilder::from_reader(source)?.with_policy(&policy, None, helper)?;

    std::io::copy(&mut decryptor, &mut sink)?;
    Ok(())
}

// --- Tauri Commands ---

#[command]
pub async fn encrypt_gpg_symmetric_raw(
    input_data: Vec<u8>,
    passphrase: String,
) -> Result<Vec<u8>, String> {
    let mut sink = Vec::new();
    let source = Cursor::new(input_data);

    encrypt_symmetric_stream(source, &mut sink, &passphrase)
        .map_err(|e| format!("Error cifrando GPG: {}", e))?;

    Ok(sink)
}

#[command]
pub async fn decrypt_gpg_symmetric_file_raw(
    file_path: String,
    passphrase: String,
) -> Result<Vec<u8>, String> {
    let file = File::open(&file_path).map_err(|e| format!("Error abriendo archivo GPG: {}", e))?;
    let mut reader = BufReader::new(file);
    let mut plaintext = Vec::new();

    decrypt_symmetric_stream(&mut reader, &mut plaintext, &passphrase)
        .map_err(|e| format!("Error descifrando GPG: {:?}", e))?;

    Ok(plaintext)
}
