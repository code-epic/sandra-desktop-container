import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';

@Injectable({
    providedIn: 'root'
})
export class DownloadService {

    constructor() { }

    /**
     * Maneja la descarga de archivos provenientes de iframes o módulos internos.
     * Soporta PDF, CSV, XLSX, DOC, ZIP, etc.
     * @param fileName Nombre sugerido del archivo.
     * @param dataBase64 Contenido del archivo en Base64 (con o sin prefijo data:...).
     */
    async handleDownload(fileName: string, dataBase64: string): Promise<boolean> {
        try {
            console.log(`📥 [DownloadService] Iniciando descarga: ${fileName}`);

            // 1. Limpiar prefijo data:URI si existe
            const base64Content = dataBase64.includes(',') ? dataBase64.split(',')[1] : dataBase64;

            // 2. Determinar extensión y filtros
            const extension = fileName.split('.').pop()?.toLowerCase() || 'dat';
            const filters = this.getFiltersForExtension(extension);

            // 3. Importar plugins de Tauri dinámicamente
            const { save } = await import('@tauri-apps/plugin-dialog');

            // 4. Abrir diálogo de guardado
            const filePath = await save({
                defaultPath: fileName,
                title: `Guardar ${extension.toUpperCase()}`,
                filters: filters
            });

            if (!filePath) {
                console.log("🚫 [DownloadService] Guardado cancelado por el usuario.");
                return false;
            }

            // 5. Guardar archivo usando Rust (Sistema de archivos seguro)
            // Usamos el comando genérico o writeBinaryFile del plugin-fs si está disponible.
            // Para consistencia con PDFs protegidos, podríamos seguir usando un comando Rust,
            // pero para archivos genéricos (zip, xlsx) es mejor usar el plugin-fs estándar o crear un comando genérico.

            // Opción A: Usar plugin-fs directamente (Más rápido para archivos normales)
            const { writeFile } = await import('@tauri-apps/plugin-fs');
            const binaryData = Uint8Array.from(atob(base64Content), c => c.charCodeAt(0));
            await writeFile(filePath, binaryData);

            // Opción B: Si necesitamos lógica de seguridad extra en backend, usaríamos invoke('save_secure_file', ...)

            console.log(`✅ [DownloadService] Archivo guardado exitosamente en: ${filePath}`);

            // TODO: Aquí podríamos inyectar logs de auditoría: "Usuario X descargó Y en ruta Z"

            return true;

        } catch (error) {
            console.error("❌ [DownloadService] Error crítico al guardar:", error);
            // Aquí podrías disparar una notificación Toast/Alert global
            return false;
        }
    }

    private getFiltersForExtension(ext: string) {
        switch (ext) {
            case 'pdf': return [{ name: 'Documento PDF', extensions: ['pdf'] }];
            case 'xlsx': return [{ name: 'Excel / Hoja de Cálculo', extensions: ['xlsx', 'xls'] }];
            case 'csv': return [{ name: 'Archivo CSV', extensions: ['csv'] }];
            case 'doc':
            case 'docx': return [{ name: 'Documento Word', extensions: ['doc', 'docx'] }];
            case 'zip':
            case 'rar': return [{ name: 'Archivo Comprimido', extensions: ['zip', 'rar', '7z'] }];
            case 'json': return [{ name: 'JSON Data', extensions: ['json'] }];
            case 'txt': return [{ name: 'Texto Plano', extensions: ['txt'] }];
            default: return [{ name: 'Todos los archivos', extensions: ['*'] }];
        }
    }
}
