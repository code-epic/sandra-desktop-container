# Auditoría y Revisión: Módulo Mailbox (SDC)

Este documento detalla el análisis de seguridad, rendimiento y estructura del flujo de sincronización implementado en `mailbox.rs`.

## 1. Análisis de Vulnerabilidades (Seguridad)

| Punto Crítico | Riesgo | Mitigación Propuesta |
| :--- | :--- | :--- |
| **Clave basada en MAC** | Bajo/Medio. La dirección MAC es descubrible o suplantable. El cifrado AES-256 es fuerte, pero la semilla (`derive_key`) es predecible. | Introducir un "Device Secret" único generado durante el setup inicial y guardado en el llavero del sistema (Keyring). |
| **Salt en Código** | Bajo. `PACKAGE_SALT` es estático. | Usar un salt dinámico derivado de una cadena única del servidor Sandra o del HWID más profundo. |
| **Falta de Firma (Seal)** | Medio. El manifiesto NDJSON se procesa tal cual llega. | Implementar un HMAC o firma digital del servidor para cada línea del manifiesto para asegurar integridad durante el stream. |
| **Inyección de Datos** | Bajo. Se usa SQLite con `params![]`. | Mantener el uso de sentencias preparadas (ya se hace). |

## 2. Optimización y Rendimiento

| Oportunidad | Impacto | Propuesta Técnica |
| :--- | :--- | :--- |
| **Descargas Concurrentes** | Elevado. Actualmente se descarga un mensaje a la vez de forma secuencial. | Usar `futures::StreamExt::buffer_unordered` para descargar hasta 3-5 mensajes simultáneamente mientras se procesa el stream del manifiesto. |
| **Transacciones SQLite** | Medio/Alto. Cada insert es una operación individual. | Envolver el procesamiento del lote de mensajes en una transacción `BEGIN; ... COMMIT;` para reducir I/O. |
| **Gestión de Memoria** | Bajo. El buffer de streaming es eficiente. | Limitar explícitamente el tamaño máximo de línea NDJSON para evitar ataques de DoS por líneas infinitas. |

## 3. Plan de Refactorización

1.  **Abstracción de Repositorio**: Mover las consultas SQL a un trait o estructura `MailboxRepository` para desacoplar el comando Tauri de la base de datos.
2.  **Servicio de Sincronización**: Extraer la lógica de `sync_mailbox` (que es muy extensa) a una estructura `SyncService` que maneje el estado del buffer y los ACKs.
3.  **Manejo de Errores**: Migrar de `String` como error a un tipo propio `MailboxError` para permitir que la UI reaccione de forma diferente según el tipo de fallo (Red, DB, Auth).

## 4. Verificación del Flujo (Línea a Línea)

- **L125-146**: Obtención de credenciales. **Correcto**, utiliza la conexión activa.
- **L161-166**: Petición Raw por streaming. **Correcto**, permite procesamiento NDJSON.
- **L172-181**: Bucle de chunks. **Optimizable**: Se puede paralelizar la descarga del mensaje completo (L190-205).
- **L185-189**: Verificación de duplicados. **Correcto**, evita descargas innecesarias.
- **L217-241**: ACK por streaming. **Correcto**, confirma la recepción de forma eficiente.
- **L243-246**: Persistencia del cursor. **Correcto**, asegura que la siguiente sincronización sea incremental.
