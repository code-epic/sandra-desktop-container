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
     * @param pin PIN opcional (Default: "1234").
     * @param forceSSE Si es true (default), los PDF se convierten a .sse (formato seguro Bunker). Si es false, se descargan como .pdf normal.
     */
    async handleDownload(fileName: string, dataBase64: string, pin: string = "1234", forceSSE: boolean = true): Promise<boolean> {
        try {
            console.log(`📥 [DownloadService] Iniciando descarga: ${fileName} (SSE: ${forceSSE})`);

            // 1. Limpiar prefijo
            const base64Content = dataBase64.includes(',') ? dataBase64.split(',')[1] : dataBase64;

            // 2. Determinar extensión base
            let originalExtension = fileName.split('.').pop()?.toLowerCase() || 'dat';

            // 3. Configurar Dialogo
            let finalFileName = fileName;
            let displayExtension = originalExtension;
            let filters = this.getFiltersForExtension(originalExtension);

            // LOGICA SSE (Prioridad Máxima si forceSSE es true)
            if (forceSSE) {
                displayExtension = 'sse';
                // Asegurar extensión .sse
                if (finalFileName.toLowerCase().endsWith('.pdf')) {
                    finalFileName = finalFileName.replace(/\.pdf$/i, '.sse');
                } else if (!finalFileName.toLowerCase().endsWith('.sse')) {
                    finalFileName = finalFileName + '.sse';
                }
                filters = [{ name: 'Bunker Encrypted Document', extensions: ['sse'] }];
            }

            // 4. Diálogo de guardado
            const { save } = await import('@tauri-apps/plugin-dialog');
            const filePath = await save({
                defaultPath: finalFileName,
                title: `Guardar ${displayExtension.toUpperCase()}`,
                filters: filters
            });

            if (!filePath) {
                console.log("🚫 [DownloadService] Cancelado.");
                return false;
            }

            // 5. Guardar Handler
            if (forceSSE) {
                // Modo Protegido (Siempre, si forceSSE es true)
                console.log("🔒 [DownloadService] Guardando como SSE...");
                await invoke('save_protected_pdf', {
                    pdfBase64: base64Content,
                    filePath: filePath,
                    pin: pin
                });
            }
            else {
                // Modo Estándar (Raw Write)
                // Usamos plugin-fs para escribir los bytes decodificados
                const { writeFile } = await import('@tauri-apps/plugin-fs');
                const binaryData = Uint8Array.from(atob(base64Content), c => c.charCodeAt(0));
                await writeFile(filePath, binaryData);
            }

            console.log(`✅ [DownloadService] Guardado en: ${filePath}`);
            return true;

        } catch (error) {
            console.error("❌ [DownloadService] Error:", error);
            return false;
        }
    }

    private getFiltersForExtension(ext: string) {
        switch (ext) {
            case 'sse': return [{ name: 'Bunker Encrypted Document', extensions: ['sse'] }];
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
