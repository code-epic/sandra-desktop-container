---
name: Architecture Skill
description: Estándares arquitectónicos para la integración Angular-Tauri y estructura de código.
---

# Habilidad de Arquitectura (Architecture Skill)

Esta habilidad define cómo estructurar el código para mantenerlo escalable, mantenible y robusto.

## 1. Separación de Responsabilidades

### Backend (Rust/Tauri)

- **Responsabilidad**: Lógica de negocio pesada, acceso a sistema de archivos, base de datos (SQLite), operaciones de sistema.
- **Exposición**: Solo exponer funciones a través de Tauri Commands (`#[tauri::command]`).
- **Retorno**: Los comandos deben retornar `Result<T, String>` o tipos serializables para manejo de errores en frontend.

### Frontend (Angular)

- **Responsabilidad**: Presentación, gestión de estado de UI, orquestación de llamadas al backend.
- **Servicios**: NUNCA llamar a `invoke` directamente desde un componente. Crea un **Service** dedicado (ej. `DesktopAppsService`) que envuelva las llamadas a Tauri. Esto facilita testing y desacoplamiento.

## 2. Componentes Angular

- **Componentes Inteligentes (Smart/Container)**: Conocen el estado, llaman a servicios, gestionan datos. (Ej. `DashboardComponent`, `AppsComponent`).
- **Componentes Tontos (Dumb/Presentational)**: Solo reciben datos (`@Input`) y emiten eventos (`@Output`). Se encargan solo de renderizar. (Ej. `AppCardComponent`).

## 3. Manejo de Estado

- Usa `Signals` (Angular moderno) o `RxJS` (BehaviorSubjects) en los servicios para compartir estado entre componentes.
- Evita prop-drilling excesivo (pasar datos por 5 niveles de componentes).

## 4. Estructura de Directorios

```
src/
  app/
    core/       # Singleton services, guards, interceptors, modelos globales
    shared/     # Componentes reutilizables, pipes, directivas
    pages/      # Componentes de página (Routed components)
    layout/     # Header, Sidebar, Footer components
```

## 5. Mapeo de Rutas y API (Project Map)

Para mantener control sobre la complejidad de un proyecto híbrido, mantendremos siempre actualizado un `docs/PROJECT_MAP.md` que detalle:

### A. Frontend: Rutas Virtuales y Orquestación

- **Rutas**: Mapeo de `tabId` (AppState) a Componentes. (Dashboard, Apps, Monitor, etc.)
- **Orquestadores**: Componentes que manejan lógica global (ej: `AppComponent` y sus handlers de `window:message`).
- **Servicios Críticos**: Resumen de su responsabilidad (ej: `SecureViewer`, `Inspector`).

### B. Backend: Comandos Tauri (API)

Documentar cada módulo (`src-tauri/src/commands/*`) con:

- **Comando**: Nombre exacto de la función (`#[tauri::command]`).
- **Input**: Argumentos y sus tipos (ej: `folder_name: String`).
- **Output**: Tipo de retorno (ej: `Result<Vec<DesktopApp>, String>`).
- **Descripción Técnica**: Lógica interna crítica (ej: "Ejecuta git clone", "Encripta con AES-256").

Esta documentación sirve como la "Fuente de Verdad" para la integración Frontend-Backend.

## Checklist de Arquitectura

- [ ] ¿La lógica de negocio compleja está en Rust?
- [ ] ¿Las llamadas a Tauri están encapsuladas en un Servicio?
- [ ] ¿El componente es demasiado grande? (>400 líneas -> considerar refactor).
- [ ] ¿Estás duplicando código? -> Mover a `shared` o `core`.
- [ ] ¿Está actualizado el `docs/PROJECT_MAP.md` con los nuevos comandos o rutas?
