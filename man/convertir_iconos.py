#!/usr/bin/env python3
"""
Script para convertir iconos SVG a PNG
Requiere: pip install cairosvg pillow
"""

import os
import sys

# Verificar dependencias
try:
    import cairosvg
    from PIL import Image
    DEPS_OK = True
except ImportError:
    DEPS_OK = False
    print("⚠️  Dependencias no instaladas.")
    print("Instala con: pip install cairosvg pillow")
    sys.exit(1)

SOURCE_DIR = "/Users/crash/sdc/man/iconos"
OUTPUT_DIR = "/Users/crash/sdc/man/iconos-png"

# Crear directorio de salida
os.makedirs(OUTPUT_DIR, exist_ok=True)

def convertir_svg_a_png(archivo_svg, output_size=(64, 64)):
    """Convierte un archivo SVG a PNG"""
    nombre_base = os.path.splitext(os.path.basename(archivo_svg))[0]
    archivo_png = os.path.join(OUTPUT_DIR, f"{nombre_base}.png")
    
    try:
        # Convertir SVG a PNG usando cairosvg
        cairosvg.svg2png(
            url=archivo_svg,
            write_to=archivo_png,
            output_width=output_size[0],
            output_height=output_size[1]
        )
        return True, nombre_base
    except Exception as e:
        return False, f"{nombre_base}: {str(e)}"

def main():
    print("🎨 Conversión de iconos SVG a PNG")
    print("=" * 50)
    
    # Obtener lista de SVGs
    archivos_svg = [f for f in os.listdir(SOURCE_DIR) if f.endswith('.svg')]
    archivos_svg.sort()
    
    print(f"📁 Encontrados {len(archivos_svg)} archivos SVG")
    print(f"💾 Directorio de salida: {OUTPUT_DIR}")
    print()
    
    exitosos = 0
    fallidos = 0
    
    for svg_file in archivos_svg:
        svg_path = os.path.join(SOURCE_DIR, svg_file)
        exito, mensaje = convertir_svg_a_png(svg_path, output_size=(64, 64))
        
        if exito:
            print(f"✅ {mensaje}.png")
            exitosos += 1
        else:
            print(f"❌ {mensaje}")
            fallidos += 1
    
    print()
    print("=" * 50)
    print(f"✅ Exitosos: {exitosos}")
    print(f"❌ Fallidos: {fallidos}")
    print(f"📁 PNGs guardados en: {OUTPUT_DIR}")

if __name__ == "__main__":
    if not DEPS_OK:
        sys.exit(1)
    main()
