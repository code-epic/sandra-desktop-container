# Plan Estratégico: Sistema de Comunicados Institucionales SDC
### Arquitectura de Mensajería Masiva Segura — 5.000 a 10.000 Usuarios

---

## 1. Estado Actual y Diagnóstico

### 1.1 Lo que ya funciona (fortalezas)

| Componente | Capacidad | Estado |
|---|---|---|
| `SyncService` (Rust) | Descarga incremental vía cursor (`last_mailbox_sync`) | ✅ Funcional |
| `StreamPostRequest` | NDJSON streaming de alto volumen | ✅ Funcional |
| `security_mailbox` (SQLite) | Almacenamiento local con deduplicación por `sid` | ✅ Funcional |
| `remote_control.rs` | Canal WebSocket con Heartbeat y reconexión exponencial | ✅ Funcional |
| `refresh-mailbox` (event) | Trigger reactivo Rust → Angular via Tauri | ✅ Integrado |
| `SDC_IMailBoxBulk` | ACK de lotes al servidor | ✅ Implementado |
| Cifrado E2E | `AES-256` por dispositivo (device_secret + MAC fallback) | ✅ Funcional |

### 1.2 Problemas Identificados (cuellos de botella)

```
PROBLEMA 1: Sin mecanismo de estado de lectura bidireccional
──────────────────────────────────────────────────────────────
El servidor no sabe si el receptor LEYÓ el correo.
Actualmente la lógica de status (Pending/Read/Approved/Rejected)
solo vive en el cliente local.

PROBLEMA 2: Descarga total en lugar de Delta
──────────────────────────────────────────────────────────────
SDC_CMailBoxUser trae TODO el buzón cada vez que se hace login.
Con 10.000 usuarios enviando y recibiendo, esto genera O(N*M)
peticiones donde N=usuarios y M=mensajes promedio.

PROBLEMA 3: Sin timestamp de último ACK sincronizado
──────────────────────────────────────────────────────────────
Cuando el servidor retransmite el stream (re-login, reconexión),
puede volver a enviar mensajes que el cliente ya tiene,
causando duplicados.

PROBLEMA 4: El emisor no sabe el estado de su mensaje
──────────────────────────────────────────────────────────────
Cuando alguien envía a 200 destinatarios, no tiene feedback
de cuántos ya lo descargaron/leyeron/aceptaron.
```

---

## 2. Protocolo de Negociación Delta (Cursor Sincronizado)

El cliente SIEMPRE lleva la iniciativa enviando su último cursor conocido.
El servidor solo responde con el delta (lo nuevo desde ese punto).

```
CLIENTE (Angular/Tauri)                  SERVIDOR (Sandra Server)
       │                                          │
       │  SDC_CMailBoxUser                        │
       │  parametros: "login@sistema"             │
       │  + cursor: <timestamp>                   │
       │─────────────────────────────────────────▶│
       │                                          │
       │  ◀──── NDJSON: Solo mensajes nuevos ─────│
       │        (desde el cursor en adelante)     │
       │                                          │
       │  SDC_IMailBoxBulk (ACK batch)            │
       │  parametros: array##"guid1","guid2"       │
       │─────────────────────────────────────────▶│
       │                                          │
       │  WebSocket: sdc_sync (PUSH)              │
       │  ◀────────────────────────────────────── │
       │  (El servidor notifica que hay novedades) │
```

---

## 3. Ciclo de Vida de un Comunicado

```
[Borrador] → [Enviado] → [Encolado] → [Descargado] → [Leído] → [Aceptado/Rechazado] → [Notificado al remitente]
                                                                          ↓
                                                                     [Expirado si TTL vence]
```

---

## 4. Plan de Implementación por Fases

### Fase 1: Sincronización Delta Robusta ⭐ PRIORIDAD ALTA
> **Objetivo**: Eliminar las descargas totales. Solo descargar lo nuevo.
> **Impacto**: Reducción del 80% del volumen descargado tras primer sync

- [ ] Leer `last_sync_cursor` de `sync_metadata` antes de hacer el stream
- [ ] Pasar el cursor como parámetro a `SDC_CMailBoxUser`
- [ ] Persistir el cursor ANTES de iniciar el stream (no al final)
- [ ] Migrar el Set de GUIDs conocidos de memoria a SQLite (para sobrevivir reinicios)
- [ ] Validar con Sandra Server si `SDC_CMailBoxUser` acepta parámetro `since_cursor`

**Código a modificar:**
- `src/app/core/services/security.service.ts` → `startMailboxSync()`
- `src-tauri/src/commands/mailbox/sync_service.rs` → `SyncService::sync()`
- `src-tauri/src/commands/mailbox/repository.rs` → `update_sync_cursor()`

---

### Fase 2: Estado Bidireccional de Lectura
> **Objetivo**: El remitente ve en tiempo real cuántos destinatarios leyeron.

- [ ] Nuevo comando: `SDC_MarkRead` — notifica al server que el usuario abrió el mensaje
- [ ] Nuevo comando: `SDC_GetDeliveryStats` — el remitente consulta el estado colectivo
- [ ] Handler WS: añadir `sdc_stats` en `remote_control.rs → process_command()`
- [ ] UI: Panel de "Seguimiento de Envío" con barra de progreso de lectura

---

### Fase 3: Flujo de Aceptación / Respuesta Formal
> **Objetivo**: Circuito completo Comunicado → Respuesta → Confirmación.

- [ ] Campo `requires_response: bool` en el manifest JSON
- [ ] Botones "Aceptar" / "Rechazar" en la UI si `requires_response === true`
- [ ] Nuevo comando: `SDC_RespondMail`
- [ ] Cadena de firma jerárquica (si aplica por estructura orgánica)

---

### Fase 4: Optimización a 10.000 Usuarios
> **Objetivo**: Sin degradación en picos de usuarios concurrentes.

- [ ] Batching de notificaciones WS (ventana de 500ms, max 10 por frame)
- [ ] Rate limiting por usuario en el servidor
- [ ] Jitter aleatorio al inicio del sync (evitar thundering herd)
- [ ] Client-side TTL: no reenviar ACK si mensaje tiene > 30 días
- [ ] Cursors persistidos en SQLite (no en memoria)

---

### Fase 5: Auditoría y Trazabilidad Legal
> **Objetivo**: Cumplimiento forense de mensajería institucional.

- [ ] Firma SHA-256 por mensaje con `device_secret`
- [ ] ACK incluye: `{ guid, device_hash, timestamp, signature }`
- [ ] Comando `SDC_ExportAuditTrail` → CSV/PDF de cadena de custodia
- [ ] Campo `ttl_hours` en el manifest para retención configurable

---

## 5. Estructura de Datos Propuesta

### Enriquecimiento del Manifest JSON
```json
{
  "manifest": {
    "guid": "94dc71ee-...",
    "sender": "admin@consola",
    "recipients": ["user1@sistema", "user2@sistema"],
    "sent_at": "2026-03-30T09:00:00Z",
    "ttl_hours": 72,
    "priority": "normal",
    "requires_ack": true,
    "requires_response": false,
    "distribution_stats": {
      "total": 150,
      "delivered": 142,
      "read": 98,
      "responded": 45
    }
  },
  "message_envelope": {
    "subject": "Circular Administrativa #2026-012",
    "body": "...",
    "attachments": []
  }
}
```

### Nuevas Columnas SQLite (Cliente Local)
```sql
ALTER TABLE security_mailbox ADD COLUMN sync_cursor TEXT;
ALTER TABLE security_mailbox ADD COLUMN ack_sent_at TEXT;
ALTER TABLE security_mailbox ADD COLUMN read_at TEXT;
ALTER TABLE security_mailbox ADD COLUMN response_status TEXT DEFAULT 'pending';
```

---

## 6. Riesgos y Mitigaciones

| Riesgo | Mitigación |
|---|---|
| Cursor desincronizado tras crash | Cursor con checksum; fallback a T-24h si inválido |
| SQLite bloqueado durante sync masivo | `PRAGMA journal_mode=WAL` |
| WS desconectado durante flush de ACKs | Cola persistente en SQLite antes del `api_post_request` |
| Duplicados por re-login antes de persistir cursor | Persistir cursor ANTES de iniciar el stream |
| Sobrecarga del servidor con 10K clientes sync simultáneos | Rate limiting + jitter aleatorio |

---

## 7. Preguntas Estratégicas Pendientes

1. ¿El servidor Go ya acepta parámetro `since_cursor` en `SDC_CMailBoxUser`?
2. ¿Los comunicados requieren respuesta formal de vuelta (ej: visto bueno)?
3. ¿Cuántos mensajes promedio por usuario por día?
4. ¿Los mensajes tienen estructura jerárquica (dirección → departamento → usuario)?
5. ¿Se requiere lectura offline (sin conexión al servidor)?

---

## Notas de Contexto del Código

- **Cursor actual**: `repo.get_sync_cursor()` y `repo.update_sync_cursor()` ya existen en `repository.rs`
- **ACK existente**: `SDC_IMailBoxBulk` con formato `array##"id1","id2"` ya funciona
- **WS Push**: `sdc_sync` en `remote_control.rs:L229` ya dispara `refresh-mailbox`
- **Servicio global**: `SecurityService.mailboxRefreshTrigger$` ya centraliza el evento
- **El Set de GUIDs** en `existingGuids` es EN MEMORIA — necesita migrar a SQLite para Fase 1
