# Tarea T8: Configuración Manual de Rendimiento

## Objetivo
Permitir al usuario anular la detección automática y elegir manualmente el nivel de detalle gráfico de la aplicación desde el panel de Configuración.

## Pasos de Ejecución
1. [ ] **Interfaz de Usuario (UI)**:
   - Agregar una sección "Rendimiento y Gráficos" en el componente `Config`.
   - Implementar un selector (Dropdown o Radio Buttons) con las opciones:
     - `Automático` (Detección por hardware).
     - `Ecosistema Full` (Gráficos altos).
     - `Modo Fluidez` (Gráficos bajos/Modo Legado).
2. [ ] **Lógica de Persistencia**:
   - Guardar la preferencia en `localStorage` o en el archivo de configuración de Rust para que persista tras reiniciar.
3. [ ] **Cambio en Tiempo Real**:
   - Asegurar que al cambiar la opción, se añada o elimine la clase CSS `.low-perf` del `body` inmediatamente.
4. [ ] **Feedback Visual**:
   - Mostrar una pequeña nota informativa explicando qué efectos se desactivan en cada modo.

## Resultados Esperados
- El usuario de un equipo antiguo puede forzar el "Modo Fluidez" si la detección automática no fuera suficiente.
- El usuario de un equipo moderno puede ver el "Modo Fluidez" por curiosidad o para ahorrar energía.
