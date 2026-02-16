# Architecture Protocol

Integración Angular-Tauri/Rust.

## 1. Responsabilidades

- **Backend (Rust)**: Lógica pesada, FS, SQLite. Exponer vía `#[tauri::command]` retornando `Result<T, String>`.
- **Frontend (Angular)**: UI y orquestación. Encapsular `invoke` SIEMPRE en Services (ej. `SecurityService`). NUNCA llamar `invoke` desde componentes.

## 2. Desarrollo Angular

- **Componentes**: Separar Smart (lógica/servicios) de Dumb (presentación/Input/Output).
- **Estado**: Preferir `Signals` o `BehaviorSubjects` en Services. Evitar prop-drilling profundo.

## 3. Estructura

- `/core`: Singletons/Guards/Common services.
- `/shared`: UI reusable.
- `/pages`: Routed components.
- `/layout`: Shell components.

## 4. Map & Sync

- Mantener `docs/PROJECT_MAP.md` como Fuente de Verdad (Rutas, Comandos, Inputs/Outputs).
- Todo comando nuevo debe documentarse en el Map antes de su uso extendido.
