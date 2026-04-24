# Plan de Implementación: Sistema de Actualizaciones Automatizadas SDC

Este plan describe la arquitectura y los pasos necesarios para implementar un sistema de actualización automática (OTA) para el **Sandra Desktop Container** en macOS, Windows y Linux, utilizando el ecosistema nativo de Tauri v2 y una experiencia de usuario premium.

## 1. Infraestructura y Configuración (Tauri Backend)

### [MODIFY] [tauri.conf.json](file:///Users/macbook/dev/rust/sandra-desktop-container/src-tauri/tauri.conf.json)
Habilitaremos el plugin de `updater` con los siguientes parámetros:
- **Endpoints**: Apuntando a la ruta raw del repositorio de GitHub (e.g., `https://raw.githubusercontent.com/user/repo/main/updater/latest.json`).
- **Signature**: Configuración de la llave pública para validación de binarios.

### [NEW] [Performance / Legacy Mode Update Sync]
Integraremos la detección de hardware para que las actualizaciones se descarguen de forma más eficiente en equipos de bajos recursos.

---

## 2. Automatización CI/CD (GitHub Actions)

### [MODIFY] [release.yml](file:///Users/macbook/dev/rust/sandra-desktop-container/.github/workflows/release.yml)
Actualizaremos el workflow de publicación para:
1. Generar las firmas de los binarios (.dmg, .msi, .AppImage) usando `TAURI_SIGNING_PRIVATE_KEY`.
2. Generar y subir el archivo `latest.json` que contiene:
   - Versión actual.
   - Notas de lanzamiento (changelog).
   - Enlaces de descarga directos a los assets del Release.
   - Firmas digitales de cada plataforma.

---

## 3. Interfaz de Usuario (Angular Frontend)

### [NEW] `UpdateService`
Un servicio Angular que envuelve el plugin `@tauri-apps/plugin-updater` para:
- `checkUpdate()`: Buscar nuevas versiones.
- `downloadAndInstall()`: Gestionar el flujo de descarga.
- Emitir eventos de progreso (0-100%).

### [MODIFY] [Configuración Tab: Updates](file:///Users/macbook/dev/rust/sandra-desktop-container/src/app/components/config/config.component.html)
Refinaremos la pestaña de actualizaciones para incluir:
- **Estado de Sincronización**: Indicador visual tipo "Badge" (Sistema Actualizado / Sincronización Pendiente).
- **Consola Técnica de Actualización**: Una sección colapsable que muestra logs en tiempo real:
  - `[INFO] Conectando con Repositorio SDC...`
  - `[INFO] Verificando firma digital (RSA-4096)...`
  - `[INFO] Descargando binario de plataforma: SandraDC_v0.1.7.msi`
- **Selector de Canal**: Opción para elegir entre canales "Estable" y "Beta".

---

## 4. Detalle Técnico: Proceso de Sincronización y Carga

Para mantener la estética premium, el proceso de actualización no será un simple diálogo de sistema, sino una "Sincronización de Motor" integrada:

### Fase A: Verificación (Loading Inicial)
Al detectar una actualización, se muestra un overlay semitransparente con un spinner tipo "PCB" y el mensaje: *Checking Integrity...*

### Fase B: Descarga (Progress Flow)
Implementaremos una barra de progreso institucional:
- **Visual**: Línea sólida en `var(--accent-primary)` con un resplandor (glow) verde.
- **Métricas**: Porcentaje, velocidad de descarga y tiempo estimado.
- **Interacción**: Botón de "Pausar" o "Ejecutar en Segundo Plano".

### Fase C: Preparación (Finalización)
Una vez descargado, el mensaje cambia a: *Compilando Actualización...* o *Preparando Instalación Segura...*. Se utiliza el patrón de diseño "Certificado" para dar el OK final.

---

## 5. Arquitectura de Repositorios

El plan contempla el uso de **GitHub Releases** como backend de entrega:
- **macOS**: Binarios .dmg firmados con Apple Developer ID.
- **Windows**: Binarios .msi firmados con certificado EV o autofirmados (para despliegues controlados).
- **Linux**: AppImages para compatibilidad universal entre distribuciones.

### Pruebas de Plataforma
- **Windows**: Verificar que el instalador .msi se descargue y ejecute correctamente.
- **macOS**: Validar que el .app se reemplace sin romper los permisos de Gatekeeper.
- **Linux**: Probar la actualización del AppImage.

### Pruebas de Interfaz
- Simular un fallo de red durante la descarga y verificar la recuperación.
- Validar que el botón "Guardar" de la pestaña de Updates persista la preferencia del usuario.

> [!IMPORTANT]
> Se requiere que el usuario genere las llaves de firma de Tauri (`tauri-apps/api/updater`) para poder firmar los binarios de forma segura.
