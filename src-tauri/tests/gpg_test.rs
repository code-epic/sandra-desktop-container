use std::fs;
use anyhow::Result;
use sandra_desktop_container_lib::commands::gpg::{encrypt_symmetric, decrypt_symmetric};

#[test]
fn test_gpg_encryption() -> Result<()> {
    let data = b"Hello world! This is a secure file.";
    let password = "super_secret_password";
    
    let encrypted = encrypt_symmetric(data, password)?;
    let decrypted = decrypt_symmetric(&encrypted, password)?;
    
    assert_eq!(data.as_ref(), decrypted.as_slice());
    
    Ok(())
}
