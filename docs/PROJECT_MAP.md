# Mapa del Proyecto: Sandra Desktop Container

Este documento describe la estructura de navegación, rutas virtuales y las funciones clave del sistema Sandra Desktop Container (SDC), facilitando la comprensión de la arquitectura híbrida (Angular + Rust/Tauri).

## 1. Estructura General

El proyecto se divide en dos áreas principales:

- **Frontend (`src/app`)**: Aplicación Angular encargada de la interfaz de usuario, gestión de pestañas y lógica de presentación.
- **Backend (`src-tauri`)**: Núcleo en Rust que maneja operaciones de sistema, seguridad, base de datos y comunicación segura.

---

## 2. Frontend: Navegación y Rutas Virtuales

SDC opera como una Single Page Application (SPA) con un gestor de pestañas personalizado (`AppStateService`), en lugar del enrutador tradicional de Angular.

### Páginas Principales (`src/app/pages/`)

Estas son las vistas principales accesibles desde el Dashboard o la barra lateral:

| Página          | Descripción                                                              | Componente                       |
| :-------------- | :----------------------------------------------------------------------- | :------------------------------- |
| **Dashboard**   | Vista principal con resumen de estado, accesos rápidos y métricas.       | `DashboardComponent`             |
| **Apps**        | Gestión de aplicaciones instaladas (búsqueda, instalación, eliminación). | `AppsComponent`                  |
| **Connections** | Configuración de conexiones a servidores remotos.                        | `ConnectionsComponent` (Asumido) |
| **Monitor**     | Telemetría del sistema en tiempo real.                                   | `MonitorComponent` (Asumido)     |
| **Security**    | Gestión de seguridad (quizás perfiles o logs).                           | `SecurityComponent` (Asumido)    |
| **Chat**        | Interfaz de comunicación.                                                | `ChatComponent`                  |

### Componentes Clave (`src/app/components/`)

Elementos reutilizables o módulos funcionales específicos:

- **Secure Viewer (`secure-viewer`)**: Visor de documentos PDF/SSE con capas de seguridad (bloqueo inicial, marcas de agua).
- **Inspector (`inspector`)**: Herramienta de depuración y logs para las aplicaciones contenerizadas.
- **Config (`config`)**: Panel de configuración general del sistema.
- **Sidebar (`sidebar`)**: Menú de navegación lateral.
- **Storage (`storage`)**: Gestión visual del sistema de archivos o base de datos local.

### Servicios Críticos (`src/app/core/services/`)

- **AppStateService**: Gestiona el estado global de pestañas abiertas, pestaña activa y datos de sesión.
- **LoggerService**: Centraliza los logs de sistema y aplicaciones.
- **DownloadService**: Intermediario para descargas seguras.
- **DesktopAppsService**: Lógica de negocio para las aplicaciones de escritorio.

---

## 3. Funciones Clave (Frontend Logic)

La lógica central reside en `AppComponent` (`src/app/app.component.ts`), actuando como orquestador.

| Función                  | Propósito                                                                                                 | Flujo                                                                |
| :----------------------- | :-------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------- |
| **handleIframeOpen**     | Abre documentos en nuevas pestañas. Intercepta PDFs protegidos (`OPEN_SSE`) para iniciar el flujo seguro. | `Frontend -> Rust (prepare_sse_preview) -> UI (Cover)`               |
| **submitTabUnlock**      | Gestiona el desbloqueo de documentos SSE protegidos.                                                      | Valida PIN -> Desencripta (Memoria o Historial) -> Muestra Contenido |
| **savePdfToHistory**     | Guarda el documento actual en el historial local, manteniendo o aplicando protección.                     | `UI -> Rust (save_protected_pdf + add_document_history)`             |
| **downloadPdfFromTab**   | Exporta el documento. Puede forzar formato SSE si el origen es protegido.                                 | `UI -> DownloadService -> Rust`                                      |
| **handleIframeDownload** | Puente para descargas iniciadas desde iframes internos.                                                   | `Iframe (Message) -> AppComponent -> DownloadService`                |

---

## 4. Backend: Mapa Detallado de API (Rust Commands)

Las funciones se invocan desde el frontend usando `invoke('comando', { args })`.

### Módulo: PDF & Seguridad (`commands/pdf.rs`)

Encargado de la manipulación, encriptación y visualización segura de documentos.
| Comando | Argumentos (Input) | Retorno (Output) | Descripción Técnica |
| :--- | :--- | :--- | :--- |
| `prepare_sse_preview` | `pdf_base64: String` | `SplitSseResponse { cover: String, content: String }` | **Crítico**. Decodifica PDF en memoria. Extrae Página 1 (Cover) y Páginas 2+ (Content). Devuelve ambos como Base64 separados. El frontend muestra Cover y oculta Content. |
| `save_protected_pdf` | `pdf_base64: String`, `file_path: String`, `pin: String` | `Result<(), String>` | Guarda el PDF en disco encriptado (AES-256 implícito o formato custom SSE) y aplica restricciones de permisos (copia/impresión). |
| `load_sse_document` | `file_path: String`, `unlock_pin: Option<String>` | `Result<String, String>` (Base64) | Lee un archivo SSE desde disco, valida el PIN (si aplica) y devuelve el contenido desencriptado en Base64 para visualización temporal. |
| `print_pdf_direct` | `pdf_base64: String`, `job_title: Option<String>` | `Result<(), String>` | Envía el stream de bytes directamente a la cola de impresión del OS, evitando diálogos de guardado intermedios. |

### Módulo: Aplicaciones (`commands/apps.rs`)

Gestión del ciclo de vida de las "Micro-Apps" instaladas en SDC.
| Comando | Argumentos (Input) | Retorno (Output) | Descripción Técnica |
| :--- | :--- | :--- | :--- |
| `get_all_apps` | - | `Vec<DesktopApp>` | Devuelve listado completo desde `desktop_apps`. Incluye credenciales (token/pass) si existen. |
| `create_app` | `app: DesktopApp` | `i64` (Row ID) | Inserta nueva app en SQLite. |
| `update_app` | `app: DesktopApp` | `()` | Actualiza metadatos de una app existente. |
| `delete_app` | `app_id: String` | `()` | Elimina registro de BD (no borra archivos físicos por defecto, ver `delete_app_repo`). |
| `download_app_repo` | `repo_url: String`, `folder_name: String` | `()` | Ejecuta `git clone` en `AppData/apps/{folder}`. Prepara el entorno para la app. |
| `update_app_repo` | `folder_name: String` | `()` | Ejecuta `git pull` en la carpeta de la app. |
| `delete_app_repo` | `folder_name: String` | `()` | `fs::remove_dir_all`. Borrado físico destructivo. |
| `open_app_window` | `folder_name: String` | `()` | Crea una **nueva ventana nativa** (Webview) apuntando a `sandra-app://127.0.0.1/{folder}/`. |
| `verify_app_installed` | `folder_name: String` | `bool` | Verifica existencia de `index.html` en `dist`. |

### Módulo: Conexiones (`commands/connections.rs`)

Gestión de conectividad WebSocket y configuración de cliente.
| Comando | Argumentos (Input) | Retorno (Output) | Descripción Técnica |
| :--- | :--- | :--- | :--- |
| `get_connections` | - | `Vec<Connection>` | Lista conexiones guardadas. |
| `save_connection` | `conn_data: Connection` | `()` | Upsert (Insertar o Actualizar) conexión en BD. |
| `connect_to_server` | `conn_data: Connection`, `client_id: String` | `()` | Inicia hilo de conexión WebSocket (Tokio/Tungstenite). Mantiene estado en `ConnectionTask`. |
| `disconnect_from_server` | `client_id: String` | `()` | Termina el hilo de conexión WebSocket y limpia recursos. |
| `get_local_ip` | - | `String` | Devuelve IP de la interfaz de red principal. |

### Módulo: Sistema & Monitor (`commands/system.rs`, `commands/monitor.rs`)

Telemetría y control del SO.
| Comando | Argumentos (Input) | Retorno (Output) | Descripción Técnica |
| :--- | :--- | :--- | :--- |
| `get_system_telemetry` | - | `SystemStats` | CPUs, RAM libre/total, Disco, MAC Address real. |
| `get_network_info` | - | `Vec<String>` | Lista IPs locales y pública (vía ipify). |
| `remote_reboot` | - | `String` | Ejecuta `shutdown /r` (Win) o `reboot` (Unix). Requiere privilegios elevados. |
| `export_database` | `target_path: String` | `String` | Copia `sdc_secure_core.db` a la ruta destino. |
| `reset_database` | - | `String` | **Peligroso**. `DROP ALL TABLES` y re-semilla datos iniciales. |

### Módulo: Logs y Diagnóstico (`commands/handler_error.rs`)

| Comando             | Argumentos (Input)       | Retorno (Output)  | Descripción Técnica                                                            |
| :------------------ | :----------------------- | :---------------- | :----------------------------------------------------------------------------- |
| `get_app_logs`      | `app_id: String`         | `Vec<AppLog>`     | Devuelve últimos 100 logs para una app específica. Deserializa JSON `details`. |
| `save_app_log`      | `log: AppLog`            | `()`              | Persistencia de logs de frontend/bridge en SQLite.                             |
| `clear_app_logs`    | `app_id: Option<String>` | `()`              | Si `app_id` es `None`, trunca toda la tabla.                                   |
| `get_db_stats`      | -                        | `DbStats`         | Tamaño de BD, conteo de tablas y estado de conexión.                           |
| `get_table_columns` | `table_name: String`     | `Vec<ColumnInfo>` | Introspección de esquema SQLite (`PRAGMA table_info`).                         |

### Módulo: Historial (`commands/history.rs`)

| Comando                   | Argumentos (Input)       | Retorno (Output)           | Descripción Técnica                             |
| :------------------------ | :----------------------- | :------------------------- | :---------------------------------------------- |
| `add_document_history`    | `file_name`, `file_path` | `()`                       | Registra acceso a documento.                    |
| `get_document_history`    | -                        | `Vec<DocumentHistoryItem>` | Últimos 20 documentos abiertos.                 |
| `delete_document_history` | `id: i32`                | `()`                       | Elimina registro del historial (no el archivo). |

### Módulo: Ventana (`commands/window.rs`)

| Comando        | Argumentos (Input) | Retorno (Output) | Descripción Técnica                                                       |
| :------------- | :----------------- | :--------------- | :------------------------------------------------------------------------ |
| `close_splash` | -                  | `()`             | Cierra ventana `splashscreen` y muestra/enfoca `main`. Usado en arranque. |

---

## 5. Tipos de Datos (Structs Clave)

### `DesktopApp`

Estructura central de aplicación.

```rust
pub struct DesktopApp {
    pub app_id: String,       // ID único (ej: "app-ventas")
    pub name: String,         // Nombre visible
    pub repo: Option<String>, // URL git para actualizaciones
    pub is_installed: bool,   // Flag de estado
    pub is_proxy_required: bool, // Si requiere proxy corporativo
    // ... credenciales opcionales (username, password, token)
}
```

### `SplitSseResponse`

Respuesta de pre-visualización segura.

```rust
pub struct SplitSseResponse {
    pub cover: String,   // Base64 página 1 (Pública)
    pub content: String, // Base64 páginas 2+ (Privada/Encriptada)
}
```

## 6. Glosario de Términos

- **SSE (Sandra Secure Element)**: Formato de documento PDF encriptado y protegido.
- **Cover Page**: Primera página de un documento SSE, visible públicamente (generalmente un QR).
- **Hidden Content**: Contenido real del documento, mantenido encriptado en memoria hasta el desbloqueo.
- **Bridge**: Mecanismo de comunicación (`window.postMessage`) entre los iframes de las apps y el contenedor principal (SDC).
