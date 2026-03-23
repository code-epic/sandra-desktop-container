# Agent Tasks: Mailbox Refactor & Security Reinforcement

Este es el plan de ejecución paso a paso para transformar el módulo Mailbox en una arquitectura robusta y eficiente.

## Fase 1: Reestructuración de Módulos (T1)
- [x] **T1.1**: Crear directorio `src-tauri/src/commands/mailbox/`
- [x] **T1.2**: Crear `src-tauri/src/commands/mailbox/mod.rs` para exportar el submódulo
- [x] **T1.3**: Mover modelos de datos de `mailbox.rs` a `types.rs`
- [x] **T1.4**: Actualizar imports y registro en `mod.rs` y `lib.rs`

## Fase 2: Capa de Persistencia - MailboxRepository (T2)
- [x] **T2.1**: Crear `repository.rs` e implementar `MailboxRepository`
- [x] **T2.2**: Implementar método `get_messages`
- [x] **T2.3**: Implementar método `insert_message` y `exists`
- [x] **T2.4**: Implementar soporte para transacciones (Integrado en CRUD básico)

## Fase 3: Procesamiento de Sincronización - SyncService (T3)
- [x] **T3.1**: Crear `src-tauri/src/commands/mailbox/sync_service.rs`
- [x] **T3.2**: Refactorizar la lógica de procesamiento NDJSON hacia `SyncService`
- [x] **T3.3**: **Optimización**: Implementar concurrencia con `buffer_unordered(5)`
- [x] **T3.4**: Integrar el ACK por streaming dentro de `SyncService`

## Fase 4: Refuerzo de Seguridad (T5)
- [x] **T5.1**: Generar y almacenar un `Device Secret` único de 32 bytes
- [x] **T5.2**: Modificar `derive_key` para priorizar el `Device Secret` sobre la MAC
- [x] **T5.3**: Implementar sistema de doble clave (Secret + Fallback MAC) para ingesta

## Fase 5: Integración y Verificación Final (T4 & T6)
- [x] **T6.1**: Actualizar los comandos Tauri en `mailbox/mod.rs` para usar el repositorio y servicio
- [x] **T6.2**: Realizar prueba de estrés con 50+ mensajes para validar concurrencia
- [x] **T6.3**: Verificar que la UI de Angular recibe correctamente los eventos post-refactor

## Fase 6: Unificación de Criptografía (T7)
- [x] **T7.1**: Centralizar Argon2 y AES-GCM en el módulo `crypto.rs`
- [x] **T7.2**: Eliminar lógica de cifrado manual en `mailbox/mod.rs`
- [x] **T7.3**: Implementar helpers binarios (`encrypt_raw`/`decrypt_raw`) para paquetes seguros
