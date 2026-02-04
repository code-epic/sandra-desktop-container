---
name: Security Skill
description: Estándares de seguridad para protección de datos y ejecución segura.
---

# Habilidad de Seguridad (Security Skill)

Esta habilidad define las prácticas obligatorias para garantizar la seguridad de la aplicación.

## 1. Validación de Entradas (Input Validation)

- **Nunca confiar en el cliente**: Toda data enviada desde Angular a Rust debe ser validada en el backend antes de usarse.
- **Tipado Fuerte**: Usa tipos de datos estrictos en Rust (`struct` con tipos específicos) en lugar de `serde_json::Value` genéricos siempre que sea posible.
- **Strings**: Limitar longitud máxima de inputs de texto para prevenir ataques de DoS o desbordamientos.

## 2. Sanitización

- **HTML/JS**: Angular escapa por defecto, pero ten cuidado con `innerHTML`. Solo úsalo si es estrictamente necesario y has sanitizado el contenido previamente.
- **SQL Injection**: Al usar bases de datos (SQLite), SIEMPRE usa parámetros (`?1`, `?2`) o el builder de queries de SQLx/Rusqlite. NUNCA concatenes strings en queries SQL.

## 3. Comandos Tauri

- **Scope**: Limita el alcance de los comandos de Tauri en `tauri.conf.json`. No habilites permisos de sistema de archivos o shell globalmente si no son necesarios.
- **Context Isolation**: Asegura que el frontend no tenga acceso directo a APIs de Node.js o sistema operativo sin pasar por la capa segura de Tauri.

## 4. Protección de Documentos (PDF)

Todo documento generado o distribuido por la aplicación debe cumplir con el **Paradigma de Información Controlada**:

- **Encriptación Obligatoria**:
  - Se debe utilizar `setEncryption` (o equivalente en la librería de generación).
  - Algoritmo mínimo: AES-128 (Idealmente AES-256 si la librería lo soporta).
  - **Password de Propietario (Owner Password)**: Debe ser robusta (ej. `SandraSec2025!`) para impedir la eliminación de restricciones.
  - **Password de Usuario**: Puede ser `undefined` si el acceso es público, pero las restricciones deben aplicarse.

- **Permisos Restrictivos (Whitelisting)**:
  - Definir explícitamente solo lo permitido.
  - **IMPRESIÓN**: Debe estar **DESHABILITADA** por defecto (omitir 'print' en la lista de permisos).
  - Permisos típicos permitidos: `['copy', 'modify', 'annot-forms']`.

- **Ejemplo de Implementación (jsPDF)**:
  ```typescript
  // Restringir impresión mediante encriptación
  // Permisos: solo copia y modificación, NO impresión
  try {
    if ((doc as any).setEncryption) {
      // (userPassword, ownerPassword, permissions, encryptionAlgorithm)
      // Nota: Al omitir 'print', se deshabilita.
      (doc as any).setEncryption(
        undefined, // Acceso sin clave para lectura
        "CLAVE_MAESTRA", // Clave requerida para cambiar permisos
        ["copy", "modify", "annot-forms"], // Lista blanca (Print excluido)
      );
    }
  } catch (error) {
    console.warn("Fallo al aplicar seguridad PDF:", error);
  }
  ```

## 5. Dependencias

- Revisa regularmente vulnerabilidades con `npm audit` y `cargo audit`.
- Evita librerías abandonadas.

## Checklist de Seguridad

- [ ] ¿El input del usuario se valida en Rust?
- [ ] ¿Las queries SQL usan parámetros?
- [ ] ¿Los permisos de Tauri son los mínimos necesarios?
- [ ] ¿Los PDFs generados tienen bloqueada la impresión?
