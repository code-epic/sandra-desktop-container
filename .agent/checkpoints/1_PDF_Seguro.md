# Checkpoint 1: PDF Seguro

## Estado al: 2026-02-08 09:42 (Hora SDC)

Fecha Actualización: 2026-02-08

## Descripción

Se ha implementado una seguridad robusta para la visualización de documentos PDF protegidos (SSE).
El sistema intercepta la apertura de documentos marcados como `isProtected` y aplica una capa de seguridad adicional.

### Características Clave:

1.  **Vista Inicial Bloqueada (Cover Page):**
    - Al abrir un documento SSE, se muestra SOLO la primera página (Portada/QR) visiblemente.
    - El resto del contenido se mantiene oculto y encriptado en memoria (`hiddenContent`).
    - Se añade un indicador visual de bloqueo (`isLocked`).

2.  **Desbloqueo en Memoria (In-Memory Unlock):**
    - Permite desbloquear el documento inmediatamente después de abrirlo, sin necesidad de guardarlo en el historial.
    - Utiliza el `hiddenContent` almacenado en la pestaña.
    - Valida un PIN (actualmente "1234" por defecto) antes de revelar el contenido completo.

3.  **Compatibilidad con Historial:**
    - Mantiene la capacidad de desbloquear documentos cargados desde el historial de archivos (`filePath`).
    - Utiliza `load_sse_document` (Rust) para desencriptar archivos guardados.

4.  **Backend (Rust):**
    - Nuevo comando `prepare_sse_preview`: Divide el PDF en Cover (Página 1) y Content (Páginas 2+).
    - Comando `save_protected_pdf`: Guarda documentos con encriptación y protección contra copia/impresión.

### Archivos Afectados

- `src/app/app.component.ts`: Lógica principal de apertura (`handleIframeOpen`), desbloqueo (`submitTabUnlock`) y gestión de pestañas.
- `src-tauri/src/commands/pdf.rs`: Comandos de bajo nivel para manipulación segura de PDFs (`prepare_sse_preview`).
- `src/app/core/services/app-state.service.ts`: Interfaz `Tab` actualizada con `isLocked` y `hiddenContent`.

## Notas Técnicas

- El contenido oculto se almacena como Base64 en la propiedad `hiddenContent` del objeto `Tab` en memoria.
- Al desbloquear, `hiddenContent` se limpia para liberar memoria.
- La descarga de documentos desbloqueados se realiza en formato PDF estándar por defecto, a menos que se fuerce SSE.

## Próximos Pasos (Opcionales / Futuros)

- Implementar validación de PIN real (Hash/Backend).
- Refinar la UI del modal de desbloqueo.
- Añadir marcas de agua dinámicas al contenido desbloqueado.
