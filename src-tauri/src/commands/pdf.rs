use base64::{engine::general_purpose, Engine as _};
use lopdf::{
    content::{Content, Operation},
    Dictionary, Document, Object, ObjectId,
};
use tauri::command;

#[command]
pub fn save_protected_pdf(
    pdf_base64: String,
    file_path: String,
    pin: String,
) -> Result<(), String> {
    // 1. Decode Base64
    let bytes = general_purpose::STANDARD
        .decode(&pdf_base64)
        .map_err(|e| format!("Base64 Error: {}", e))?;

    // 2. Load PDF
    let mut doc =
        Document::load_from(bytes.as_slice()).map_err(|e| format!("PDF Load Error: {}", e))?;

    // --- CHECK IF ALREADY PROTECTED ---
    let pages_check = doc.get_pages();
    let mut already_protected = false;
    if let Some(&p1_id) = pages_check.get(&1) {
        if let Ok(pd) = doc.get_object(p1_id).and_then(|o| o.as_dict()) {
            if let Ok(Object::Array(annots)) = pd.get(b"Annots") {
                for ann in annots {
                    // Annots can be direct objects or references
                    let annot_dict_res = match ann {
                        Object::Reference(r) => doc.get_object(*r).and_then(|o| o.as_dict()),
                        Object::Dictionary(d) => Ok(d),
                        _ => Err(lopdf::Error::Type),
                    };

                    if let Ok(ad) = annot_dict_res {
                        if let Ok(Object::String(t, _)) = ad.get(b"T") {
                            if String::from_utf8_lossy(t) == "UnlockBtn" {
                                already_protected = true;
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    if already_protected {
        // Just save with SSE Header
        let mut clean_buffer = Vec::new();
        doc.save_to(&mut clean_buffer)
            .map_err(|e| format!("PDF Save Error: {}", e))?;

        if clean_buffer.len() > 4 {
            clean_buffer[1] = b'S';
            clean_buffer[2] = b'S';
            clean_buffer[3] = b'E';
        }

        std::fs::write(&file_path, clean_buffer).map_err(|e| format!("File Write Error: {}", e))?;
        return Ok(());
    }
    // ----------------------------------

    // 3. Setup OCGs
    let ocg_censura_id = doc.add_object(Dictionary::from_iter(vec![
        ("Type", "OCG".into()),
        ("Name", "Censura".into()),
    ]));
    let ocg_contenido_id = doc.add_object(Dictionary::from_iter(vec![
        ("Type", "OCG".into()),
        ("Name", "Contenido".into()),
    ]));

    let catalog_id = match doc.trailer.get(b"Root") {
        Ok(obj) => match obj.as_reference() {
            Ok(r) => r,
            Err(_) => return Err("PDF structure error: Root is not a reference".to_string()),
        },
        Err(_) => return Err("PDF structure error: Missing Root".to_string()),
    };

    // Config: BaseState ON.
    let ocg_config = Dictionary::from_iter(vec![
        ("BaseState", "ON".into()),
        (
            "Order",
            Object::Array(vec![ocg_censura_id.into(), ocg_contenido_id.into()]),
        ),
        (
            "ON",
            Object::Array(vec![ocg_censura_id.into(), ocg_contenido_id.into()]),
        ),
    ]);

    let oc_properties = Dictionary::from_iter(vec![
        (
            "OCGs",
            Object::Array(vec![ocg_censura_id.into(), ocg_contenido_id.into()]),
        ),
        ("D", ocg_config.into()),
    ]);

    // --- VIEWER PREFERENCES ---
    let viewer_prefs = Dictionary::from_iter(vec![
        ("HideToolbar", Object::Boolean(true)),
        ("HideMenubar", Object::Boolean(true)),
        ("HideWindowUI", Object::Boolean(true)),
        ("FitWindow", Object::Boolean(true)),
        ("CenterWindow", Object::Boolean(true)),
    ]);

    if let Ok(catalog) = doc.get_object_mut(catalog_id).and_then(|o| o.as_dict_mut()) {
        catalog.set("OCProperties", oc_properties);
        catalog.set("ViewerPreferences", Object::Dictionary(viewer_prefs));
    }

    // 4. Procesar Páginas
    let pages = doc.get_pages();
    let page_ids: Vec<ObjectId> = pages.values().cloned().collect();

    for (i, page_id) in page_ids.iter().enumerate() {
        let page_num = i + 1;

        // --- Recursos & MediaBox ---
        let resources_id = match doc
            .get_object(*page_id)
            .and_then(|o| o.as_dict())
            .and_then(|d| d.get(b"Resources"))
        {
            Ok(Object::Reference(rid)) => *rid,
            _ => continue,
        };
        if let Ok(resources) = doc
            .get_object_mut(resources_id)
            .and_then(|o| o.as_dict_mut())
        {
            let mut properties = Dictionary::new();
            properties.set("CensuraLayer", Object::Reference(ocg_censura_id));
            properties.set("ContenidoLayer", Object::Reference(ocg_contenido_id));
            if resources.get(b"Properties").is_err() {
                resources.set("Properties", properties);
            } else if let Ok(Object::Dictionary(d)) = resources.get_mut(b"Properties") {
                d.set("CensuraLayer", Object::Reference(ocg_censura_id));
                d.set("ContenidoLayer", Object::Reference(ocg_contenido_id));
            }

            let fonts_dict = if let Ok(Object::Dictionary(f)) = resources.get_mut(b"Font") {
                f
            } else {
                resources.set("Font", Dictionary::new());
                match resources.get_mut(b"Font") {
                    Ok(Object::Dictionary(f)) => f,
                    _ => panic!("Font dict fail"),
                }
            };
            fonts_dict.set(
                "Helv",
                Dictionary::from_iter(vec![
                    ("Type", "Font".into()),
                    ("Subtype", "Type1".into()),
                    ("BaseFont", "Helvetica".into()),
                ]),
            );
            fonts_dict.set(
                "HelvB",
                Dictionary::from_iter(vec![
                    ("Type", "Font".into()),
                    ("Subtype", "Type1".into()),
                    ("BaseFont", "Helvetica-Bold".into()),
                ]),
            );
        }

        let mut page_box = (0.0, 0.0, 595.0, 842.0);
        if let Ok(pd) = doc.get_object(*page_id).and_then(|o| o.as_dict()) {
            if let Ok(Object::Array(arr)) = pd.get(b"MediaBox") {
                if arr.len() >= 4 {
                    page_box = (
                        arr[0].as_float().unwrap_or(0.),
                        arr[1].as_float().unwrap_or(0.),
                        arr[2].as_float().unwrap_or(595.),
                        arr[3].as_float().unwrap_or(842.),
                    );
                }
            }
        }
        let (_x_min_p, _y_min_p, page_width, page_height) = (
            page_box.0,
            page_box.1,
            page_box.2 - page_box.0,
            page_box.3 - page_box.1,
        );

        if let Ok(content_data) = doc.get_page_content(*page_id) {
            if let Ok(content) = Content::decode(&content_data) {
                let mut new_operations: Vec<Operation> = Vec::new();

                if page_num == 1 {
                    // --- PAGINA 1 ---
                    let mut split_index = None;
                    for (idx, op) in content.operations.iter().enumerate() {
                        let mut is_target = false;
                        if op.operator == "rg" && op.operands.len() == 3 {
                            if op.operands[0].as_float().unwrap_or(1.) < 0.2 {
                                is_target = true;
                            }
                        } else if op.operator == "re" && op.operands.len() == 4 {
                            if op.operands[2].as_float().unwrap_or(0.) > 150. {
                                is_target = true;
                            }
                        }
                        if is_target {
                            split_index = Some(idx);
                        }
                    }
                    new_operations.push(Operation::new(
                        "BDC",
                        vec!["OC".into(), "ContenidoLayer".into()],
                    ));
                    let cut = split_index.unwrap_or(content.operations.len());
                    for i in 0..cut {
                        new_operations.push(content.operations[i].clone());
                    }
                    new_operations.push(Operation::new("EMC", vec![]));
                    if cut < content.operations.len() {
                        new_operations.push(Operation::new(
                            "BDC",
                            vec!["OC".into(), "CensuraLayer".into()],
                        ));
                        for i in cut..content.operations.len() {
                            new_operations.push(content.operations[i].clone());
                        }
                        new_operations.push(Operation::new("EMC", vec![]));
                    }

                    // --- BOTÓN VISIBLE (Posición Ajustada: Bajado 100u, Texto Centrado) ---
                    let btn_w = 400.0;
                    let btn_h = 50.0;
                    let x = (page_width - btn_w) / 2.0;
                    let y = (page_height / 2.0) - 100.0;

                    new_operations.push(Operation::new("q", vec![]));
                    new_operations.push(Operation::new(
                        "BDC",
                        vec!["OC".into(), "CensuraLayer".into()],
                    ));
                    new_operations.push(Operation::new("0.1 0.1 0.3 RG", vec![]));
                    new_operations.push(Operation::new("2 w", vec![]));
                    new_operations.push(Operation::new("0.92 0.95 1.0 rg", vec![]));
                    new_operations.push(Operation::new(
                        "re",
                        vec![x.into(), y.into(), btn_w.into(), btn_h.into()],
                    ));
                    new_operations.push(Operation::new("B", vec![]));
                    new_operations.push(Operation::new("BT", vec![]));
                    new_operations.push(Operation::new("0 0 0.5 rg", vec![]));
                    new_operations.push(Operation::new("/HelvB", vec![14.into(), "Tf".into()]));
                    new_operations.push(Operation::new(
                        "Td",
                        vec![(x + 25.).into(), (y + 18.).into()],
                    ));
                    new_operations.push(Operation::new(
                        "Tj",
                        vec![Object::String(
                            ">> CLIC AQUI PARA DESBLOQUEAR DOC <<".into(),
                            lopdf::StringFormat::Literal,
                        )],
                    ));
                    new_operations.push(Operation::new("ET", vec![]));
                    new_operations.push(Operation::new("EMC", vec![]));
                    new_operations.push(Operation::new("Q", vec![]));

                    // --- JAVASCRIPT REFORZADO ---
                    let mut ph: i32 = 0;
                    for c in pin.chars() {
                        ph = ph.wrapping_shl(5).wrapping_sub(ph).wrapping_add(c as i32);
                    }

                    let js_code_btn = format!(
                        r#"
                        var _b64=function(s){{var e={{}},i,b=0,c,x,l=0,a,r='',w=String.fromCharCode,L=s.length;var A="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";for(i=0;i<64;i++){{e[A.charAt(i)]=i;}}for(x=0;x<L;x++){{c=e[s.charAt(x)];b=(b<<6)+c;l+=6;while(l>=8){{((a=(b>>>(l-=8))&0xff)||(x<(L-2)))&&(r+=w(a));}}}}return r;}};

                        var _0x = "Q2Vuc3VyYQ==";  
                        var _0y = "Q29udGVuaWRv"; 
                        var _0z = "UGFnZU1hc2tf"; 
                        
                        try {{
                            var _qt = _b64("SWQgdmFsaWRhZG9yIGRlIFBERjo=");
                            var _tt = _b64("U2FuZHJhIFNlcnZlciAtIENvbmZpZGVuY2lhbA==");
                            var _p = app.response({{ cQuestion: _qt, cTitle: _tt, bPassword: true }});
                            
                            if (_p) {{
                                var _h = 0;
                                for (var i=0; i<_p.length; i++) {{
                                    _h = ((_h << 5) - _h) + _p.charCodeAt(i);
                                    _h |= 0;
                                }}
                                if (_h === {}) {{
                                    var _u = false;
                                    try {{
                                        var _l = this.getOCGs();
                                        if (_l) {{
                                            var _cn = _b64(_0x); var _ct = _b64(_0y);
                                            for (var i=0; i<_l.length; i++) {{
                                                if(_l[i].name===_cn) _l[i].state=false;
                                                if(_l[i].name===_ct) _l[i].state=true;
                                            }}
                                            _u = true;
                                        }}
                                    }} catch(e) {{}}
                                    try {{
                                        var _m = _b64(_0z);
                                        for (var n=1; n<=this.numPages; n++) {{
                                            var f = this.getField(_m + n);
                                            if (f) f.display = display.hidden;
                                        }}
                                        _u = true;
                                    }} catch(e) {{}}
                                    
                                    if (_u) {{
                                         app.alert(_b64("QWNjZXNvIENvbmNlZGlkby4=")); 
                                         try {{ if (this.numPages > 1) this.deletePages(0); }} catch(e) {{}}
                                    }}
                                }} else {{
                                    app.alert(_b64("Q29kaWdvIEluY29ycmVjdG8u")); 
                                    try {{ this.closeDoc(); }} catch(e) {{}}
                                }}
                            }} else {{
                                try {{ this.closeDoc(); }} catch(e) {{}}
                            }}
                        }} catch (e) {{
                            app.alert("Viewer Security Error.");
                        }}
                        "#,
                        ph
                    );

                    let action_dict = Dictionary::from_iter(vec![
                        ("Type", "Action".into()),
                        ("S", "JavaScript".into()),
                        (
                            "JS",
                            Object::String(js_code_btn.into(), lopdf::StringFormat::Literal),
                        ),
                    ]);
                    let aa_dict = Dictionary::from_iter(vec![
                        ("U", Object::Dictionary(action_dict.clone())),
                        ("D", Object::Dictionary(action_dict.clone())),
                    ]);
                    let annot_dict = Dictionary::from_iter(vec![
                        ("Type", "Annot".into()),
                        ("Subtype", "Widget".into()),
                        ("FT", "Btn".into()),
                        ("Ff", 65536.into()),
                        (
                            "T",
                            Object::String("UnlockBtn".into(), lopdf::StringFormat::Literal),
                        ),
                        (
                            "Rect",
                            Object::Array(vec![
                                x.into(),
                                y.into(),
                                (x + btn_w).into(),
                                (y + btn_h).into(),
                            ]),
                        ),
                        ("A", Object::Dictionary(action_dict)),
                        ("AA", Object::Dictionary(aa_dict)),
                        ("F", 4.into()),
                        (
                            "MK",
                            Object::Dictionary(Dictionary::from_iter(vec![
                                ("BG", Object::Array(vec![])),
                                ("BC", Object::Array(vec![])),
                            ])),
                        ),
                    ]);
                    let annot_id = doc.add_object(annot_dict);
                    if let Ok(pd) = doc.get_object_mut(*page_id).and_then(|o| o.as_dict_mut()) {
                        let v = match pd.get_mut(b"Annots") {
                            Ok(Object::Array(v)) => v,
                            _ => {
                                pd.set("Annots", Object::Array(vec![]));
                                if let Ok(Object::Array(v)) = pd.get_mut(b"Annots") {
                                    v
                                } else {
                                    panic!()
                                }
                            }
                        };
                        v.push(Object::Reference(annot_id));
                    }
                } else {
                    // --- PAGINA 2+ ---
                    new_operations.extend(content.operations);
                    // MÁSCARA REFORZADA
                    let mask_rect = vec![0.into(), 0.into(), page_width.into(), page_height.into()];
                    let mask_dict = Dictionary::from_iter(vec![
                        ("Type", "Annot".into()),
                        ("Subtype", "Widget".into()),
                        ("FT", "Btn".into()),
                        ("Ff", 65537.into()),
                        (
                            "T",
                            Object::String(
                                format!("PageMask_{}", page_num).into(),
                                lopdf::StringFormat::Literal,
                            ),
                        ),
                        ("Rect", Object::Array(mask_rect)),
                        ("F", 4.into()),
                        (
                            "MK",
                            Object::Dictionary(Dictionary::from_iter(vec![(
                                "BG",
                                Object::Array(vec![0.75.into()]),
                            )])),
                        ),
                    ]);
                    let mask_id = doc.add_object(mask_dict);
                    if let Ok(pd) = doc.get_object_mut(*page_id).and_then(|o| o.as_dict_mut()) {
                        let v = match pd.get_mut(b"Annots") {
                            Ok(Object::Array(v)) => v,
                            _ => {
                                pd.set("Annots", Object::Array(vec![]));
                                if let Ok(Object::Array(v)) = pd.get_mut(b"Annots") {
                                    v
                                } else {
                                    panic!()
                                }
                            }
                        };
                        v.push(Object::Reference(mask_id));
                    }
                }

                let new_content_bytes = Content {
                    operations: new_operations,
                }
                .encode()
                .unwrap_or(content_data.clone());
                let _ = doc.change_page_content(*page_id, new_content_bytes);
            }
        }
    }

    // --- OPEN ACTION ---
    let js_open = format!(
        r#"
        var _b64=function(s){{var e={{}},i,b=0,c,x,l=0,a,r='',w=String.fromCharCode,L=s.length;var A="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";for(i=0;i<64;i++){{e[A.charAt(i)]=i;}}for(x=0;x<L;x++){{c=e[s.charAt(x)];b=(b<<6)+c;l+=6;while(l>=8){{((a=(b>>>(l-=8))&0xff)||(x<(L-2)))&&(r+=w(a));}}}}return r;}};
        app.alert(_b64("UERGIHByb3RlZ2lkbyBwb3IgU2FuZHJhIFNlcnZlci4="));
        "#
    );
    let open_action_dict = Dictionary::from_iter(vec![
        ("Type", "Action".into()),
        ("S", "JavaScript".into()),
        (
            "JS",
            Object::String(js_open.into(), lopdf::StringFormat::Literal),
        ),
    ]);
    if let Ok(catalog) = doc.get_object_mut(catalog_id).and_then(|o| o.as_dict_mut()) {
        catalog.set("OpenAction", Object::Dictionary(open_action_dict));
    }

    // 5. GUARDADO SEGURO
    let mut clean_buffer = Vec::new();
    doc.save_to(&mut clean_buffer)
        .map_err(|e| format!("PDF Save Error: {}", e))?;

    if clean_buffer.len() > 4 {
        clean_buffer[1] = b'S';
        clean_buffer[2] = b'S';
        clean_buffer[3] = b'E';
    }

    std::fs::write(&file_path, clean_buffer).map_err(|e| format!("File Write Error: {}", e))?;

    Ok(())
}

#[command]
pub fn load_sse_document(file_path: String, unlock_pin: Option<String>) -> Result<String, String> {
    // 1. Leer archivo binario
    let mut data = std::fs::read(&file_path).map_err(|e| format!("Read Error: {}", e))?;

    // 2. Verificar cabecera propietaria %SSE
    // Magic: %SSE (37 83 83 69)
    if data.len() > 4 && data[0] == 37 && data[1] == 83 && data[2] == 83 && data[3] == 69 {
        // Restaurar cabecera PDF (%PDF)
        data[1] = 80;
        data[2] = 68;
        data[3] = 70;
    }

    // 3. Si NO hay PIN, devolvemos el documento tal cual (Censurado/Bloqueado)
    if unlock_pin.is_none() {
        let b64 = general_purpose::STANDARD.encode(&data);
        return Ok(b64);
    }

    // 4. Si HAY PIN, intentamos desbloquearlo en memoria
    let user_pin = unlock_pin.unwrap();

    // Configurar lopdf
    let mut doc =
        Document::load_from(data.as_slice()).map_err(|e| format!("PDF Load Error: {}", e))?;

    // A. Calcular Hash del PIN introducido
    let mut ph: i32 = 0;
    for c in user_pin.chars() {
        ph = ph.wrapping_shl(5).wrapping_sub(ph).wrapping_add(c as i32);
    }

    // B. Buscar el Hash almacenado en el PDF
    let mut stored_hash: Option<i32> = None;

    for (_, object) in doc.objects.iter() {
        if let Ok(dict) = object.as_dict() {
            if let Ok(Ok(t_str)) = dict.get(b"T").map(|o| o.as_str()) {
                if t_str == b"UnlockBtn" {
                    if let Ok(dict_a) = dict.get(b"A").and_then(|o| o.as_dict()) {
                        if let Ok(Ok(js_code)) = dict_a.get(b"JS").map(|o| o.as_str()) {
                            let js = String::from_utf8_lossy(js_code);
                            if let Some(idx) = js.find("if (_h === ") {
                                let rest = &js[idx + 11..];
                                if let Some(end_idx) = rest.find(")") {
                                    let num_str = &rest[..end_idx].trim();
                                    if let Ok(num) = num_str.parse::<i32>() {
                                        stored_hash = Some(num);
                                    }
                                }
                            }
                        }
                    }
                    break;
                }
            }
        }
    }

    // C. Verificar Hash
    if let Some(target_hash) = stored_hash {
        if target_hash != ph {
            return Err("PIN Incorrecto".to_string());
        }
    } else {
        // No encontramos mecanismo de bloqueo, retornamos sin cambios pero OK
        let b64 = general_purpose::STANDARD.encode(&data);
        return Ok(b64);
    }

    // D. Hash Correcto -> EJECUTAR DESBLOQUEO EN MEMORIA (OCG FLIP)
    let mut censura_id = None;
    let mut contenido_id = None;

    for (id, object) in doc.objects.iter() {
        if let Ok(dict) = object.as_dict() {
            if let Ok(type_name) = dict.get(b"Type").and_then(|o| o.as_name_str()) {
                if type_name == "OCG" {
                    if let Ok(Ok(name_str)) = dict.get(b"Name").map(|o| o.as_str()) {
                        if name_str == b"Censura" {
                            censura_id = Some(*id);
                        } else if name_str == b"Contenido" {
                            contenido_id = Some(*id);
                        }
                    }
                }
            }
        }
    }

    if let (Some(cid), Some(tid)) = (censura_id, contenido_id) {
        if let Ok(catalog_ref) = doc.trailer.get(b"Root").and_then(|o| o.as_reference()) {
            if let Ok(cat_dict) = doc
                .get_object_mut(catalog_ref)
                .and_then(|o| o.as_dict_mut())
            {
                if let Ok(Object::Dictionary(oc_props)) = cat_dict.get_mut(b"OCProperties") {
                    if let Ok(Object::Dictionary(d_config)) = oc_props.get_mut(b"D") {
                        d_config.set("OFF", Object::Array(vec![Object::Reference(cid)]));
                        d_config.set("ON", Object::Array(vec![Object::Reference(tid)]));
                    }
                }
            }
        }
    }

    // Eliminar Capa Visual de Bloqueo
    let page_ids: Vec<ObjectId> = doc.get_pages().values().cloned().collect();

    for pid in page_ids {
        // Step 1: Identify Annots to Remove (Immutable Access)
        let mut to_remove: Vec<ObjectId> = Vec::new();
        let mut annot_refs = Vec::new();

        // Read Annots from Page (Immutable)
        if let Ok(pd) = doc.get_object(pid).and_then(|o| o.as_dict()) {
            if let Ok(Object::Array(annots)) = pd.get(b"Annots") {
                for ann in annots {
                    if let Object::Reference(rid) = ann {
                        annot_refs.push(*rid);
                    }
                }
            }
        }

        // Check each annotation contents (Immutable)
        for rid in annot_refs {
            if let Ok(ad) = doc.get_object(rid).and_then(|o| o.as_dict()) {
                if let Ok(Ok(t_str)) = ad.get(b"T").map(|o| o.as_str()) {
                    if t_str == b"UnlockBtn" || t_str.starts_with(b"PageMask_") {
                        to_remove.push(rid);
                    }
                }
            }
        }

        // Step 2: Remove from Page (Mutable Access)
        if !to_remove.is_empty() {
            if let Ok(pd) = doc.get_object_mut(pid).and_then(|o| o.as_dict_mut()) {
                if let Ok(Object::Array(annots)) = pd.get_mut(b"Annots") {
                    let mut keep_list = Vec::new();
                    for ann in annots.iter() {
                        if let Object::Reference(rid) = ann {
                            if !to_remove.contains(rid) {
                                keep_list.push(ann.clone());
                            }
                        } else {
                            keep_list.push(ann.clone());
                        }
                    }
                    *annots = keep_list;
                }
            }
        }
    }

    // E. ELIMINAR PORTADA (Página 1)
    // El documento unlocked debe mostrar directo el contenido.
    // Usamos delete_pages (índices 1-based)
    doc.delete_pages(&[1]);
    doc.prune_objects();

    // Guardar desbloqueado
    let mut clean_buffer = Vec::new();
    if doc.save_to(&mut clean_buffer).is_ok() {
        let b64 = general_purpose::STANDARD.encode(&clean_buffer);
        return Ok(b64);
    }

    return Err("Error procesando PDF protegido".to_string());
}

#[command]
pub fn print_pdf_direct(pdf_base64: String, job_title: Option<String>) -> Result<(), String> {
    // 1. Decode Base64
    let bytes = general_purpose::STANDARD
        .decode(&pdf_base64)
        .map_err(|e| format!("Base64 Error: {}", e))?;

    // 2. Create Temp File
    let mut temp_path = std::env::temp_dir();
    let filename = format!(
        "sandra_print_{}.pdf",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    temp_path.push(filename);
    let path_str = temp_path.to_string_lossy().to_string();

    std::fs::write(&path_str, bytes).map_err(|e| format!("Write Temp Error: {}", e))?;

    // 3. Execute System Print Command

    // MacOS / Linux: "lp" (CUPS)
    #[cfg(target_family = "unix")]
    {
        use std::process::Command;

        // Try lp first (Standard CUPS)
        let mut cmd = Command::new("lp");
        cmd.arg(&path_str);

        if let Some(ref title) = job_title {
            cmd.arg("-t").arg(title);
        }

        match cmd.output() {
            Ok(output) if output.status.success() => {
                // Success with lp
            }
            _ => {
                // Fallback to various LPR implementations
                let mut cmd_lpr = Command::new("lpr");
                cmd_lpr.arg(&path_str);

                if let Some(title) = job_title {
                    cmd_lpr.arg("-T").arg(title);
                }

                let out_lpr = cmd_lpr
                    .output()
                    .map_err(|e| format!("Error interno al ejecutar lpr: {}", e))?;

                if !out_lpr.status.success() {
                    let err_raw = String::from_utf8_lossy(&out_lpr.stderr);

                    // Human-friendly error translation
                    if err_raw.contains("No default destination") {
                        return Err("No hay una impresora predeterminada configurada en el sistema OS. Por favor configure una impresora por defecto.".to_string());
                    } else if err_raw.contains("not found") {
                        return Err(
                            "No se encontró el servicio de impresión (CUPS/LPR) instalado."
                                .to_string(),
                        );
                    } else {
                        return Err(format!(
                            "Error del sistema de impresión: {}",
                            err_raw.trim()
                        ));
                    }
                }
            }
        }
    }

    // Windows: PowerShell "Print" Verb
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;

        // Use PowerShell to trigger the default "Print" action for .pdf
        let status = Command::new("powershell")
            .arg("-Command")
            .arg(format!(
                "Start-Process -FilePath '{}' -Verb Print",
                path_str
            ))
            .status()
            .map_err(|e| format!("Error al iniciar impresión en Windows: {}", e))?;

        if !status.success() {
            return Err("El comando de impresión de Windows falló. Verifique si tiene un lector de PDF predeterminado instalado.".to_string());
        }
    }

    // 4. Cleanup handled by OS Temp Policy
    Ok(())
}
