---
name: Security Skill
description: Estándares de seguridad para protección de datos y ejecución segura.
---

# Security Protocol

## 1. Validación & Sanitización

- **Zero Trust**: Validar TODA data en Rust (`structs` estrictos) antes de procesar.
- **SQL**: Usar SIEMPRE parámetros (`?1`). NUNCA concatenar strings.
- **Frontend**: Evitar `innerHTML`. Sanitizar si es inevitable.

## 2. Comandos Tauri

- **Scope**: Mínimos privilegios en `tauri.conf.json`.
- **Isolation**: Frontend sin acceso directo a Node/OS.

## 3. PDF Governance (Obligatorio)

- **Encryption**: AES-128/256 con Owner Password robusta.
- **No-Print**: Bloqueo de impresión por defecto (eliminar `print` de permisos).
- **Whitelist**: Solo permitir `['copy', 'modify', 'annot-forms']`.

## 4. Auditoría

- `npm audit` / `cargo audit` frecuentes.
- Loggear eventos críticos (fallos de auth, acceso a documentos).
