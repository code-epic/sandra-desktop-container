# Análisis de Rendimiento y Optimización para Hardware Legado

Este plan tiene como objetivo diagnosticar y mitigar los problemas de lentitud (lag) detectados en equipos con recursos limitados (CPU Pentium Dual E2180, 1GB RAM).

## Tareas de Diagnóstico

- [x] **T1: Perfilado de Memoria y CPU**
  - Evaluar el impacto de la instancia de WebView2 (Chromium) en 1GB de RAM.
  - Medir la carga base con y sin los efectos visuales actuales.

- [x] **T2: Identificación de Cuellos de Botella Visuales**
  - Probar la fluidez desactivando `backdrop-filter: blur(10px)`.
  - Evaluar el consumo de GPU/CPU de las animaciones `globalSlowFloat`.
  - Medir el impacto de la imagen de fondo `tech-bubbles.png` y el patrón de circuitos.

- [x] **T3: Análisis de IPC (Inter-Process Communication)**
  - Revisar si las llamadas frecuentes a `invoke` están saturando el bus de comunicación en un procesador Dual Core antiguo.

## Tareas de Optimización

- [x] **T4: Implementación de Algoritmo de Evaluación de Hardware**
  - Crear un servicio que detecte RAM disponible y potencia de CPU.
  - Establecer umbrales (ej: < 2GB RAM = Modo de Alto Rendimiento / Gráficos Bajos).

- [x] **T5: Creación del "Modo Legado" (Low Graphics Mode)**
  - Implementar una clase CSS global `.perf-low` que:
    - Desactive `backdrop-filter`.
    - Sustituya gradientes complejos por colores sólidos.
    - Detenga animaciones de fondo.
    - Simplifique las sombras (`box-shadow`).

- [x] **T6: Optimización de Angular**
  - Revisar la estrategia de detección de cambios (`OnPush`) en componentes pesados.
  - Lazy loading de componentes del Setup Wizard que no se ven de inmediato.

- [x] **T7: Ajustes de Tauri/Rust**
  - Evaluar la desactivación forzada de aceleración por hardware en GPUs antiguas que no soportan bien DirectX 12 / Vulkan.

- [x] **T8: Configuración Manual de Rendimiento**
  - Añadir selectores en el panel de Configuración para control manual del usuario.
  - Implementar persistencia de la elección.
  - Implementar persistencia de la elección.
