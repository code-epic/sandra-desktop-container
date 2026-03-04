#!/bin/bash
# Script para extraer iconos SVG específicos de FontAwesome usados en SDC
# Usa los iconos exactos de la aplicación Angular

SOURCE_DIR="/Users/crash/sdc/node_modules/@fortawesome/fontawesome-free/svgs/solid"
DEST_DIR="/Users/crash/sdc/man/iconos"

# Crear directorio de destino si no existe
mkdir -p "$DEST_DIR"

# Limpiar iconos anteriores
rm -f "$DEST_DIR"/*.svg

echo "Extrayendo iconos SVG específicos de SDC..."

# Iconos usados en la navegación y dashboard de SDC
ICONOS_SDC=(
    # Navegación Sidebar
    "th-large"          # Dashboard
    "network-wired"     # Conexiones
    "globe"             # Aplicaciones
    "shield-alt"        # Seguridad
    "desktop"           # Monitor
    "file-shield"       # Visor Seguro
    "book"              # Ayuda Wiki
    "sliders-h"         # Configuración
    "sign-out-alt"      # Cerrar Sesión
    
    # Dashboard - Métricas
    "network-wired"     # Red
    "hdd"               # Espacio/Almacenamiento
    "database"          # Core DB
    
    # UI General
    "bars"              # Menú hamburguesa
    "redo-alt"          # Refrescar
    "times"             # Cerrar
    "microchip"         # Logo/CPU
    "globe-americas"    # Modo Libre
    
    # Acciones
    "arrow-right"       # Siguiente/Abrir
    "arrow-left"        # Anterior
    "sync-alt"          # Actualizar
    "sync"              # Sincronizar
    "folder-minus"      # Eliminar/Quitar
    "plus"              # Agregar/Nuevo
    "minus"             # Quitar
    "edit"              # Editar
    "save"              # Guardar
    "search"            # Buscar
    "filter"            # Filtrar
    "history"           # Historial
    "trash"             # Papelera
    "upload"            # Subir
    "download"          # Descargar
    "expand"            # Expandir
    "compress"          # Comprimir
    "power-off"         # Apagar
    "question-circle"   # Ayuda
    
    # Hardware/Sistema
    "memory"            # RAM
    "microchip"         # CPU
    "wifi"              # WiFi
    "ethernet"          # Ethernet
    "fingerprint"       # Identidad
    "users"             # Usuarios/Área
    "user"              # Usuario
    
    # Configuración/Seguridad
    "cog"               # Configuración
    "info-circle"       # Información
    "times-circle"      # Error
    "check-circle"      # Éxito/Check
    "exclamation-triangle" # Advertencia
    "link"              # Proxy/Enlace
    "server"            # Servidor
    "plug"              # Conexión
    "code"              # Aplicación/Código
    "file-alt"          # Documento/Archivo
    "eye"               # Visor/Ver
    "unlock"            # Desbloquear
    "lock"              # Bloquear
    "key"               # Cifrado
    "robot"             # Sandra AI
)

# Copiar iconos
for icono in "${ICONOS_SDC[@]}"; do
    src_file="$SOURCE_DIR/${icono}.svg"
    if [ -f "$src_file" ]; then
        cp "$src_file" "$DEST_DIR/"
        echo "✓ ${icono}.svg"
    else
        echo "✗ No encontrado: ${icono}.svg"
    fi
done

echo ""
echo "========================================="
echo "Iconos extraidos en: $DEST_DIR"
echo "Total: $(ls -1 "$DEST_DIR"/*.svg 2>/dev/null | wc -l) iconos"
echo "========================================="
