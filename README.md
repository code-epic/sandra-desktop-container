# Sandra Desktop Container (SDC)

### Plataforma de Orquestación Segura para Aplicaciones Distribuidas

**Sandra Desktop Container (SDC)** es una arquitectura de software de vanguardia diseñada para la gestión, orquestación y ejecución segura de micro-aplicaciones de escritorio. Construida sobre la robustez de **Rust** y la versatilidad de **Angular**, SDC redefine el concepto de "contenedor de aplicaciones" al proporcionar un entorno aislado, cifrado y de alto rendimiento que actúa como un sistema operativo de capa superior.

---

## 🚀 Visión Técnica y Futuro

SDC no es simplemente un lanzador de aplicaciones; es un **Orquestador de Entornos Seguros**. Su propósito es abstraer la complejidad del sistema operativo subyacente (macOS, Linux, Windows) para ofrecer una interfaz unificada, segura y controlada donde las aplicaciones empresariales críticas pueden ejecutarse sin interferencias externas.

El futuro de SDC apunta hacia la **Computación Descentralizada y Privada**, donde el contenedor gestiona no solo la ejecución de la UI, sino también la identidad soberana del usuario, las llaves criptográficas y la persistencia de datos local-first, eliminando la dependencia absoluta de la nube para operaciones sensibles.

---

## 🛠 Stack Tecnológico

La arquitectura de SDC combina lo mejor del rendimiento nativo y la flexibilidad web:

### 核心 (Core) - Rust & Tauri 2.0

- **Seguridad de Memoria**: El backend está escrito íntegramente en **Rust**, garantizando la ausencia de errores de segmentación y condiciones de carrera, cumpliendo con los estándares más altos de robustez (Memory Safety).
- **Runtime Asíncrono**: Utiliza `tokio` para manejar miles de conexiones WebSocket concurrentes con latencia cercana a cero.
- **IPC Seguro**: La comunicación entre la UI y el Sistema Operativo se realiza a través de un puente IPC (Inter-Process Communication) aislado, impidiendo la inyección de código arbitrario.

### Interfaz (Frontend) - Angular (Standalone Architecture)

- **Diseño Modular**: Arquitectura basada en Componentes Standalone (Signals, Observables) para una reactividad instantánea.
- **Gestión de Estado**: Servicios reactivos (`SdcService`, `AppStateService`) que sincronizan la telemetría del sistema en tiempo real.
- **Estética UX/UI**: Sistema de diseño "Sandra Teal Soft", enfocado en la reducción de carga cognitiva mediante paletas pastel y tipografía inter.

---

## 🛡️ Estándares de Seguridad y Normativas ISO

SDC ha sido diseñado siguiendo rigurosamente principios de **Seguridad por Diseño (Security by Design)**, alineándose con normativas internacionales:

### 1. Cifrado y Protección de Datos (ISO/IEC 27001)

Cumplimos con los controles de criptografía de la norma ISO 27001 para asegurar la confidencialidad e integridad:

- **En Reposo**: Base de Dtos **SQLite Cipher** con cifrado **AES-256-GCM**. Ningún dato persiste en disco en texto plano.
- **En Tránsito**: Comunicaciones obligatorias sobre **TLS 1.3** y **WSS (WebSocket Secure)**, rechazando conexiones degradadas o inseguras.
- **Hashing**: Uso de **Argon2** para el derivado y verificación de credenciales, resistente a ataques de fuerza bruta y GPU/ASIC.

### 2. Calidad del Software (ISO/IEC 25010)

- **Aislamiento (Sandboxing)**: Cada micro-aplicación se ejecuta en un contexto `iframe` controlado con políticas de seguridad de contenido (CSP) estrictas, evitando el Cross-Site Scripting (XSS) entre módulos.
- **Trazabilidad**: El **Inspector SDC** integrado ofrece un registro inmutable de eventos (Log, Red, Sistema) que permite auditorías forenses precisas sin comprometer la privacidad (los logs de vista se limpian de la memoria de sesión sin afectar la persistencia legal en BD).

---

## 🧩 Capacidades del Contenedor

### Inspector y Depuración en Tiempo Real

Una herramienta de ingeniería inversa integrada que permite:

- Interceptación pasiva de peticiones de red (Fetch/XHR) de aplicaciones de terceros.
- Visualización de logs de sistema y de aplicaciones satélite.
- **Gestión de Sesión en Memoria**: Capacidad de limpiar la vista del operador (`sessionLogs Map`) sin destruir la evidencia forense almacenada en la base de datos segura.

### Telemetría y Monitorización

El módulo **Monitor** utiliza `sysinfo` para extraer métricas de bajo nivel (CPU, RAM, Red) y presentarlas visualmente, permitiendo al operador tomar decisiones basadas en el estado real del hardware.

### Sistema de Actualizaciones Atómicas

SDC puede descargar, instalar y actualizar micro-aplicaciones (`sandra-app://`) desde repositorios remotos seguros, verificando la integridad de los paquetes antes de su ejecución.

---

## 📦 Instalación y Desarrollo

```bash
# Instalar dependencias del frontend
npm install

# Ejecutar en modo desarrollo (Hot Reload)
npm run tauri dev

# Compilar para producción (Release optimizado)
npm run tauri build
```

---

> _"En un mundo de software efímero, Sandra Desktop Container establece un estándar de permanencia, seguridad y control."_
