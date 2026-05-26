use anyhow::Result;
use std::io::Cursor;
use sandra_desktop_container_lib::commands::gpg::{encrypt_symmetric_stream, decrypt_symmetric_stream};

#[test]
fn test_gpg_encryption() -> Result<()> {
    let data = b"Hello world! This is a secure file.";
    let password = "super_secret_password";
    
    let mut encrypted = Vec::new();
    encrypt_symmetric_stream(Cursor::new(data), &mut encrypted, password)?;
    
    let mut decrypted = Vec::new();
    decrypt_symmetric_stream(Cursor::new(&encrypted), &mut decrypted, password)?;
    
    assert_eq!(data.as_ref(), decrypted.as_slice());
    
    Ok(())
}

