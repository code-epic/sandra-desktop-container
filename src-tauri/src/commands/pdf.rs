use base64::{engine::general_purpose, Engine as _};
use lopdf::{Dictionary, Document, Object};
use std::fs::File;
use tauri::command;

#[command]
pub fn save_protected_pdf(
    pdf_base64: String,
    file_path: String,
    password: Option<String>,
) -> Result<(), String> {
    // 1. Decode Base64
    let bytes = general_purpose::STANDARD
        .decode(&pdf_base64)
        .map_err(|e| format!("Base64 Error: {}", e))?;

    // 2. Load PDF
    let mut doc =
        Document::load_from(bytes.as_slice()).map_err(|e| format!("PDF Load Error: {}", e))?;

    // 3. Estrategia de Seguridad:
    // A) ViewerPreferences: Ocultar Toolbar / Menubar (Dificulta el acceso al botón print)
    let mut preferences = Dictionary::new();
    preferences.set("HideToolbar", Object::Boolean(true));
    preferences.set("HideMenubar", Object::Boolean(true));
    preferences.set("HideWindowUI", Object::Boolean(true));

    // Insert into Catalog
    // Paso 1: Obtener referencia al Root (Catalog)
    // Corrección: obj.as_reference() retorna Result<(u32, u16), Error> en versiones recientes o
    // tal vez retornaba Option en versiones viejas. El error dice: found `Result`.
    // Por lo tanto, debemos manejar el Result correctamente con Ok/Err en el match interior.

    let root_ref = match doc.trailer.get(b"Root") {
        Ok(obj) => match obj.as_reference() {
            Ok(r) => r,
            Err(_) => return Err("PDF structure error: Root is not a reference".to_string()),
        },
        Err(_) => return Err("PDF structure error: Missing Root".to_string()),
    };

    // Paso 2: Obtener el objeto mutable del Catalog
    if let Ok(catalog_obj) = doc.get_object_mut(root_ref) {
        if let Ok(catalog) = catalog_obj.as_dict_mut() {
            catalog.set("ViewerPreferences", Object::Dictionary(preferences));
        }
    }

    // 4. Save to Disk
    let mut file = File::create(&file_path).map_err(|e| format!("File Create Error: {}", e))?;

    doc.save_to(&mut file)
        .map_err(|e| format!("PDF Save Error: {}", e))?;

    Ok(())
}
