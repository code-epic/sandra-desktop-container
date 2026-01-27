---
name: Design Skill
description: Estándares de diseño premium y modernas prácticas de UI/UX para aplicaciones Angular/Tauri.
---

# Habilidad de Diseño (Design Skill)

Esta habilidad define los estándares estéticos y de experiencia de usuario que DEBEN aplicarse a todo desarrollo de interfaz.

## 1. Filosofía de Diseño "Premium"

Todas las interfaces deben evocar calidad, modernidad y limpieza.

- **Minimalismo con Profundidad**: Usa sombras suaves (`box-shadow`), gradientes sutiles y espacio en blanco (whitespace) generoso.
- **Glassmorphism**: Implementa efectos de desenfoque de fondo (`backdrop-filter: blur()`) para modales y paneles flotantes donde sea apropiado.
- **Tipografía**: Usa fuentes modernas sans-serif (ej. Inter, Roboto, Outfit). Asegura jerarquías claras (H1 vs H2 vs Body).

## 2. Paleta de Colores y Temas

- Evita colores puros (ej. `#FF0000`, `#0000FF`). Usa variantes ajustadas en HSL o palettes curadas (Material Design 3, Tailwind Colors).
- **Modo Oscuro/Claro**: Diseña pensando en variables CSS (`var(--bg-primary)`, `var(--text-main)`) para facilitar el cambio de temas.

## 3. Interactividad y Animaciones

Una interfaz estática se siente "rota".

- **Estados Hover/Active**: Todos los elementos interactivos (botones, cards, inputs) deben tener estados visuales claros al pasar el mouse o hacer clic.
- **Transiciones**: Usa `transition: all 0.3s ease` por defecto para cambios de estado suaves.
- **Micro-interacciones**: Feedback visual inmediato al completar acciones (ej. checkmarks animados, spinner de carga, breadcrumbs).

## 4. Componentes

- **Botones**: Bordes redondeados, padding generoso, sin bordes predeterminados feos.
- **Inputs**: Bordes sutiles, focus ring visible pero estético.
- **Cards**: Bordes redondeados, sombra suave al hover.

## 5. CSS

- Preferencia por **CSS Vainilla** con Variables CSS para máxima flexibilidad, o Tailwind si el proyecto ya lo usa.
- Evita estilos inline.

## Checklist de Validación de Diseño

Antes de finalizar una tarea de UI, verifica:

- [ ] ¿Se ve moderno y profesional?
- [ ] ¿Hay feedback visual al interactuar?
- [ ] ¿Es responsive (funciona al redimensionar)?
- [ ] ¿Los colores son accesibles?
