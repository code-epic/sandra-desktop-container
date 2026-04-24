# Tarea T5: Implementación de Modo Legado (Low Graphics)

## Objetivo
Reducir la carga de renderizado del WebView para que el sistema sea fluido en equipos con 1GB de RAM.

## Estrategia de Optimización
1. [ ] **Eliminar Blur**: `backdrop-filter: blur` es extremadamente costoso en CPUs antiguas sin GPU dedicada potente. Cambiar por fondos semi-opacos sólidos.
2. [ ] **Frenar Animaciones**: Desactivar `globalSlowFloat` (el movimiento del fondo).
3. [ ] **Optimizar Gráficos**:
   - Cambiar `radial-gradient` por un patrón SVG estático o color plano.
   - Reducir la opacidad del `tech-bubbles.png` o no cargarla en modo legado.
4. [ ] **Simplificar Sombras**: Cambiar `box-shadow` complejos por bordes simples de 1px.

## Resultados Esperados
- Reducción del uso de CPU del proceso de renderizado (Chromium) en al menos un 40%.
- Eliminación del lag al abrir modales y desplazarse por las políticas.
