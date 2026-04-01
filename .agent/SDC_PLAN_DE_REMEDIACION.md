# Plan de Remediación - Sandra Desktop Container

## Resumen Ejecutivo

El plan se divide en **5 fases** secuenciales, priorizadas por criticidad y dependencias entre tareas.

---

## FASE 1: Seguridad Crítica (Backend Rust)
**Objetivo**: Corregir vulnerabilidades que exponen el sistema a ataques directos

### Paso 1.1: TLS Deshabilitado
- [ ] **1.1.1** Revisar `src-tauri/src/commands/api.rs:91-92, 155-156, 222-224`
- [ ] **1.1.2** Revisar `src-tauri/src/commands/file_upload.rs:94-95`
- [ ] **1.1.3** Revisar `src-tauri/src/commands/secure_download.rs:168-169`
- [ ] **1.1.4** Revisar `src-tauri/src/commands/connections.rs:406-407`
- [ ] **1.1.5** Eliminar `danger_accept_invalid_certs(true)` de todos los clientes HTTP
- [ ] **1.1.6** Crear helper `create_secure_client()` en módulo compartido

### Paso 1.2: Dependencias Vulnerables
- [ ] **1.2.1** Actualizar `Cargo.toml` - remover `allow-experimental-crypto` de sequoia-openpgp
- [ ] **1.2.2** Actualizar `lopdf` a versión estable reciente
- [ ] **1.2.3** Ejecutar `cargo audit` para verificar otras vulnerabilidades

### Paso 1.3: Inyección de Comandos
- [ ] **1.3.1** Revisar `src-tauri/src/commands/apps.rs:25-27`
- [ ] **1.3.2** Implementar validación de URL git antes de ejecutar clone
- [ ] **1.3.3** Agregar allowlist de repositorios permitidos (opcional)

### Paso 1.4: Criptografía Débil
- [ ] **1.4.1** Revisar `src-tauri/src/sha256.rs:56-60`
- [ ] **1.4.2** Reemplazar padding con ceros por KDF adecuado (argon2 o PBKDF2)
- [ ] **1.4.3** Revisar `src-tauri/src/crypto.rs:12` - hardcoded salt

### Paso 1.5: Almacenamiento Inseguro
- [ ] **1.5.1** Revisar `src-tauri/src/storage.rs:75-128`
- [ ] **1.5.2** Cifrar campos sensibles (password, token) en SQLite
- [ ] **1.5.3** Implementar hash de contraseñas con argon2

### Paso 1.6: Path Traversal
- [ ] **1.6.1** Revisar `src-tauri/src/commands/system.rs:45, 60` - arbitrary write
- [ ] **1.6.2** Revisar `src-tauri/src/commands/file_upload.rs:19-21` - arbitrary read
- [ ] **1.6.3** Implementar validación de paths (canonicalize + allowlist)

---

## FASE 2: Seguridad Crítica (Frontend Angular)
**Objetivo**: Corregir vulnerabilidades en la capa de presentación

### Paso 2.1: Protección CSRF
- [ ] **2.1.1** Revisar `src/app/app.config.ts:7, 16`
- [ ] **2.1.2** Habilitar XSRF protection en provideHttpClient
- [ ] **2.1.3** Configurar interceptor para token CSRF

### Paso 2.2: postMessage Seguro
- [ ] **2.2.1** Revisar `src/app/app.component.ts:1487, 2427, 2430, 2520`
- [ ] **2.2.2** Reemplazar wildcard `*` con origen válido
- [ ] **2.2.3** Validar `event.origin` en `logger.service.ts:106-131`

### Paso 2.3: Manejo de Tokens
- [ ] **2.3.1** Revisar `src/app/components/login-modal/login-modal.component.ts:239-243`
- [ ] **2.3.2** Migrar JWT de localStorage a sessionStorage
- [ ] **2.3.3** Implementar validación JWT completa en backend (firma + expiración)

### Paso 2.4: Sanitización de Contenido
- [ ] **2.4.1** Revisar `src/app/components/inspector/inspector.component.ts:183, 239, 245`
- [ ] **2.4.2** Eliminar bypassSecurityTrustHtml donde sea posible
- [ ] **2.4.3** Usar DOMPurify para sanitizar HTML antes de renderizar
- [ ] **2.4.4** Revisar `src/app/pages/security/security.component.ts:1130` - innerHTML

---

## FASE 3: Refactorización de Código Duplicado (Rust)
**Objetivo**: Consolidar lógica repetida en módulos reutilizables

### Paso 3.1: Unificar Crypto
- [ ] **3.1.1** Revisar `crypto.rs` y `sha256.rs` - AES-256-GCM duplicado
- [ ] **3.1.2** Migrar toda lógica AES a un solo módulo
- [ ] **3.1.3** Eliminar código redundante de `sha256.rs`

### Paso 3.2: HTTP Client Factory
- [ ] **3.2.1** Crear `src-tauri/src/http_client.rs`
- [ ] **3.2.2** Implementar cliente HTTP compartido con configuración centralizada
- [ ] **3.2.3** Actualizar `api.rs`, `proxy/*.rs`, `connections.rs` para usar factory

### Paso 3.3: Helper Functions en API
- [ ] **3.3.1** Extraer `get_connection_hash()` en `api.rs` (repetido 3 veces)
- [ ] **3.3.2** Extraer `build_device_context()` compartido entre api.rs y remote_control.rs
- [ ] **3.3.3** Crear `ConnectionRepository` trait para row mapping

### Paso 3.4: Proxy Utils
- [ ] **3.4.1** Revisar `proxy/remote.rs` y `proxy/external.rs` - header filtering duplicado
- [ ] **3.4.2** Crear `proxy/utils.rs` con función `filter_headers()`

---

## FASE 4: Refactorización de Código Duplicado (Angular)
**Objetivo**: Crear componentes y servicios reutilizables

### Paso 4.1: Auth Centralizado
- [ ] **4.1.1** Crear `src/app/core/services/auth.service.ts`
- [ ] **4.1.2** Implementar método `checkAuth()` único
- [ ] **4.1.3** Crear `AuthGuard` para protección de rutas
- [ ] **4.1.4** Eliminar validación JWT duplicada en componentes

### Paso 4.2: Componente Modal Reutilizable
- [ ] **4.2.1** Crear `src/app/components/modal/modal.component.ts`
- [ ] **4.2.2** Diseñar API con @Input() para show, title, @Output() para onConfirm
- [ ] **4.2.3** Migrar 40+ modals existentes al nuevo componente
- [ ] **4.2.4** Eliminar CSS duplicado de modal-overlay

### Paso 4.3: Utils Service
- [x] **4.3.1** Crear `src/app/core/services/utils.service.ts`
- [x] **4.3.2** Mover `formatBytes()` - duplicado en app.component.ts y dashboard
- [x] **4.3.3** Mover `safeJsonParse<T>()` - repetido 15+ veces
- [x] **4.3.4** Agregar helpers de fecha/tiempo

### Paso 4.4: Paginación y Filtros
- [ ] **4.4.1** Crear componente o directive de paginación reutilizable
- [ ] **4.4.2** Extraer lógica de filtrado a pipe o función compartida

### Paso 4.5: Storage Service
- [ ] **4.5.1** Crear `src/app/core/services/storage.service.ts`
- [ ] **4.5.2** Abstraer operaciones localStorage/sessionStorage
- [ ] **4.5.3** Migrar código duplicado en chat.component.ts, security.component.ts

---

## FASE 5: Limpieza y Hardening
**Objetivo**: Remover código de debug y mejorar postura de seguridad

### Paso 5.1: Remover Debug Output
- [ ] **5.1.1** Eliminar todos los `println!` en producción (Rust)
- [ ] **5.1.2** Eliminar `console.log/warn/error` innecesarios (Angular)
- [ ] **5.1.3** Configurar logging framework con niveles apropiados

### Paso 5.2: Validación de Input
- [ ] **5.2.1** Agregar validación de IP/ports en api.rs
- [ ] **5.2.2** Implementar validación de formato en commands
- [ ] **5.2.3** Usar crate `validator` para validaciones complejas

### Paso 5.3: Políticas de Seguridad
- [ ] **5.3.1** Fortalecer regex de passwords en security.rs
- [ ] **5.3.2** Agregar verificación de ownership en IDOR (security.rs)
- [ ] **5.3.3** Implementar rate limiting en endpoints sensibles

### Paso 5.4: Testing
- [ ] **5.4.1** Agregar tests unitarios para funciones de crypto refactorizadas
- [ ] **5.4.2** Agregar tests de integración para validación de input
- [ ] **5.4.3** Ejecutar `npm audit` y `cargo audit` regularmente

---

## Dependencias entre Fases

```
FASE 1 (Crítica) ─────────┐
    ↓                      │
FASE 2 (Crítica) ─────────┼──→ FASE 5 (Limpieza)
    ↓                      │
FASE 3 (Refactor Rust) ───┤
    ↓                      │
FASE 4 (Refactor Angular) ┘
```

---

## Vulnerabilidades Identificadas (Referencia Rápida)

### Rust Backend - CRITICAL
| # | Vulnerabilidad | Severidad | Archivo | Líneas |
|---|---------------|-----------|---------|--------|
| 1 | TLS Deshabilitado | CRITICAL | api.rs, file_upload.rs, secure_download.rs, connections.rs | Múltiples |
| 2 | Dependencias Vulnerables | CRITICAL | Cargo.toml | 48, 65-67 |
| 3 | Inyección de Comandos | HIGH | apps.rs | 25-27 |
| 4 | Clave Débil (Padding) | HIGH | sha256.rs | 56-60 |
| 5 | Contraseñas en Texto Plano | HIGH | storage.rs | 75-128 |
| 6 | Escritura de Archivos Arbitraria | HIGH | system.rs | 45, 60 |
| 7 | Lectura de Archivos Arbitraria | HIGH | file_upload.rs | 19-21 |
| 8 | Inyección SQL | MEDIUM | handler_error.rs | 37 |

### Angular Frontend - CRITICAL
| # | Vulnerabilidad | Severidad | Archivo | Líneas |
|---|---------------|-----------|---------|--------|
| 1 | Sin Protección CSRF | CRITICAL | app.config.ts | 7, 16 |
| 2 | postMessage sin Validar | HIGH | app.component.ts | 1487, 2427, 2430, 2520 |
| 3 | JWT en localStorage | HIGH | login-modal.component.ts | 239-243 |
| 4 | Validación JWT Débil | HIGH | security.component.ts | 444-452 |
| 5 | Contraseña en Memoria | HIGH | security.component.ts | 852-853 |
| 6 | bypassSecurityTrustHtml | MEDIUM | inspector.component.ts | 183, 239, 245 |

### Código Duplicado - Rust
| Duplicación | Líneas Afectadas | Ubicaciones |
|------------|------------------|-------------|
| Lógica AES-256-GCM | ~70 líneas | crypto.rs, sha256.rs |
| HTTP Client Builder | ~30 líneas | api.rs, proxy/remote.rs, proxy/external.rs |
| Hash Retrieval DB | ~39 líneas | api.rs (3 repeticiones) |
| Device Context Encryption | ~45 líneas | api.rs, remote_control.rs |
| Connection Row Mapping | ~40 líneas | connections.rs, proxy/remote.rs |

### Código Duplicado - Angular
| Duplicación | Repeticiones | Ubicaciones |
|------------|---------------|-------------|
| Patrón Auth JWT | 3+ veces | monitor, security, app components |
| JSON.parse con try-catch | 15+ veces | Múltiples componentes |
| Estructura Modal HTML | 40+ veces | Múltiples componentes |
| CSS .modal-overlay | 60+ veces | Múltiples archivos .css |
| formatBytes | 2 veces | app.component.ts, dashboard.component.ts |
| Lógica de Paginación | 3+ veces | security, monitor, secure-viewer |

---

## Recomendaciones de Ejecución

### Orden Sugerido
1. **Fase 1** (Seguridad Crítica Rust) - Comenzar inmediatamente
2. **Fase 2** (Seguridad Crítica Angular) - En paralelo con Fase 1
3. **Fase 3** (Refactor Rust) - Después de corregir vulnerabilidades
4. **Fase 4** (Refactor Angular) - Después de Fase 3
5. **Fase 5** (Limpieza) - Última fase

### Verificaciones Post-Re太祖ón
- Ejecutar `cargo clippy` y `cargo fmt` después de cambios Rust
- Ejecutar `npm run lint` y `ng lint` después de cambios Angular
- Ejecutar tests existentes para asegurar no regresiones
- Realizar análisis de seguridad con `cargo audit` y `npm audit`
