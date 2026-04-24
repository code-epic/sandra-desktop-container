# Documentación Técnica: Motor de Rendimiento Adaptativo (SDC-PE)

## 1. Introducción
Sandra Desktop Container (SDC) está diseñado para operar en entornos diversos, desde estaciones de trabajo modernas hasta terminales recuperados con hardware limitado. El **Motor de Rendimiento Adaptativo (Performance Engine)** es el componente encargado de equilibrar la fidelidad visual con la estabilidad operativa.

## 2. Diagnóstico de Hardware Legado (Caso de Estudio)
El desarrollo de este motor se basó en el análisis de equipos con:
- **CPU**: Intel Pentium Dual Core E2180.
- **RAM**: 1.00 GB.
- **SO**: Windows 10 LTSB.

### Cuellos de Botella Identificados:
- **Chromium Overhead**: El WebView2 consume entre 300MB-500MB base.
- **GPU Limitada**: El renderizado de `backdrop-filter: blur()` y `radial-gradient` dinámicos satura el CPU al no haber descarga en GPU.
- **Context Switching**: El procesador de 2 núcleos se bloquea al intentar procesar animaciones de 60FPS y lógica de red simultáneamente.

## 3. Arquitectura del Motor (T4)

El motor opera en tres capas:

### A. Capa de Sensado (Rust)
Utiliza el crate `sysinfo` para extraer métricas de hardware de bajo nivel de forma determinista.
- **Comando**: `get_system_telemetry`
- **Métrica Clave**: `total_memory` (bytes).

### B. Capa de Mediación (Angular)
El `PerformanceService` actúa como el orquestador en el frontend.
- **Umbrales de Rendimiento**:
  - **LOW (< 2GB RAM)**: Activa el "Modo Legado".
  - **MEDIUM (2GB - 4GB RAM)**: Equilibrio entre estética y velocidad.
  - **HIGH (> 4GB RAM)**: Experiencia visual completa (Elite Glass).

### C. Capa de Aplicación (CSS)
El servicio inyecta una clase global en el `<body>`.
- `.perf-low`: Desactiva blur, congela animaciones de fondo, simplifica sombras.
- `.perf-medium`: Reduce la intensidad del blur y la frecuencia de animaciones.
- `.perf-high`: Habilita todos los efectos premium.

## 4. Estrategias de Optimización (T5 - T7)

### Estilos (CSS)
- **Eliminación de Blur**: Sustitución de `backdrop-filter: blur(10px)` por fondos semi-opacos `rgba` sólidos.
- **Animaciones Estáticas**: Desactivación de `@keyframes` infinitos en elementos de fondo.
- **Optimización de Bitmaps**: Evitar el escalado dinámico de imágenes pesadas.

### Lógica (Angular)
- **ChangeDetection Strategy**: Uso de `ChangeDetectionStrategy.OnPush` para reducir los ciclos de verificación de Angular.
- **Debouncing de IPC**: Reducción de la frecuencia de llamadas `invoke` para telemetría no crítica.

## 5. Control de Usuario (T8)
Aunque el sistema es automático, se proporciona un selector manual en **Configuración > Temas > Rendimiento** para que el operador pueda forzar un modo específico según su preferencia de fluidez o estética.

---
> _Sandra: Eficiencia Sostenible en Hardware Soberano._
