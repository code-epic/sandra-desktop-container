import { Component, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { invoke } from '@tauri-apps/api/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { AppStateService } from '../../core/services/app-state.service';

@Component({
    selector: 'app-secure-viewer',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './secure-viewer.component.html',
    styleUrls: ['./secure-viewer.component.css']
})
export class SecureViewerComponent {
    @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

    isLoading = false;
    fileName: string = '';
    error: string | null = null;
    history: any[] = [];

    isDragging = false;

    constructor(
        private sanitizer: DomSanitizer,
        private appState: AppStateService
    ) {
        this.loadHistory();
    }

    async loadHistory() {
        try {
            this.history = await invoke('get_document_history');
        } catch (e) {
            console.warn("Could not load history", e);
        }
    }

    onDragOver(event: DragEvent) {
        event.preventDefault();
        this.isDragging = true;
    }

    onDragLeave(event: DragEvent) {
        event.preventDefault();
        this.isDragging = false;
    }

    onDrop(event: DragEvent) {
        event.preventDefault();
        this.isDragging = false;

        if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
            this.error = "Por favor usa el botón 'Abrir Documento Seguro'.";
        }
    }

    async openFileDialog() {
        try {
            this.isLoading = true;
            const { open } = await import('@tauri-apps/plugin-dialog');

            const selected = await open({
                multiple: false,
                filters: [{
                    name: 'Bunker Documents',
                    extensions: ['sse', 'pdf']
                }]
            });

            if (selected && typeof selected === 'string') {
                this.fileName = selected.split(/[\\/]/).pop() || selected;
                await this.loadSecureDoc(selected, true);
            } else {
                this.isLoading = false;
            }
        } catch (e) {
            console.error(e);
            this.error = "Error al abrir diálogo.";
            this.isLoading = false;
        }
    }

    async openFromHistory(item: any) {
        this.fileName = item.file_name;
        // item.file_path comes from DB
        await this.loadSecureDoc(item.file_path, false);
    }



    // Modal State
    showDeleteModal = false;
    itemToDelete: any = null;

    // Export & Unlock State
    showExportModal = false;
    showUnlockModal = false;
    itemToExport: any = null;
    unlockPin: string = '';
    isExportingUnlocked = false; // logic flag

    // --- Export Logic ---
    promptExport(item: any, event: Event) {
        event.stopPropagation();
        this.itemToExport = item;
        this.showExportModal = true;
    }

    cancelExport() {
        this.showExportModal = false;
        this.itemToExport = null;
    }

    confirmExport(keepProtection: boolean) {
        this.showExportModal = false;
        if (keepProtection) {
            // Export AS IS (Physical Copy)
            this.exportFilePhysical(this.itemToExport);
        } else {
            // Unlocked Export -> Ask for PIN
            this.isExportingUnlocked = true;
            this.unlockPin = '';
            this.showUnlockModal = true;
        }
    }

    cancelUnlock() {
        this.showUnlockModal = false;
        this.unlockPin = '';
    }

    // Result Modal State
    resultModal = { show: false, title: '', message: '', isError: false };

    closeResultModal() {
        this.resultModal.show = false;
    }

    async submitUnlock() {
        if (!this.unlockPin) return;
        const pin = this.unlockPin;
        this.showUnlockModal = false; // Close modal (loading will show in button if we bridged it, but here we can just show global spinner)

        try {
            this.isLoading = true;
            // 1. Load Unlocked Content
            // Note: backend 'load_sse_document' signature: (file_path, unlock_pin)
            const base64Data = await invoke<string>('load_sse_document', {
                filePath: this.itemToExport.file_path,
                unlockPin: pin
            });

            // 2. Save logic
            const { save } = await import('@tauri-apps/plugin-dialog');
            const savePath = await save({
                defaultPath: this.itemToExport.file_name.replace('.sse', '_unlocked.pdf'),
                filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
            });

            if (savePath) {
                // Write Base64 to file
                // Convert base64 to Uint8Array
                const byteCharacters = atob(base64Data);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);

                const { writeFile } = await import('@tauri-apps/plugin-fs');
                await writeFile(savePath, byteArray);

                this.resultModal = {
                    show: true,
                    title: 'Exportación Exitosa',
                    message: 'El documento ha sido desbloqueado y exportado correctamente.',
                    isError: false
                };
            }

        } catch (e: any) {
            console.error("Unlock Error:", e);
            if (e && typeof e === 'string' && e.includes("PIN Incorrecto")) {
                this.resultModal = {
                    show: true,
                    title: 'Error de Seguridad',
                    message: 'El PIN ingresado es incorrecto. No se puede desbloquear el archivo.',
                    isError: true
                };
            } else {
                this.resultModal = {
                    show: true,
                    title: 'Error de Exportación',
                    message: 'Ocurrió un error inesperado: ' + e,
                    isError: true
                };
            }
        } finally {
            this.isLoading = false;
            this.itemToExport = null;
            this.unlockPin = '';
        }
    }

    async exportFilePhysical(item: any) {
        try {
            // Just copy the bitstream
            const { save } = await import('@tauri-apps/plugin-dialog');
            // If original is .sse, we suggest .pdf so it opens with prompt? Or keep .sse?
            // "manteniendo las reglas creadas" -> .sse or PDF with JS lock. 
            // Better to keep .pdf extension so users try to open it and see lock.
            const savePath = await save({
                defaultPath: item.file_name.replace('.sse', '_protected.pdf'),
                filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
            });

            if (savePath) {
                const { readFile, writeFile } = await import('@tauri-apps/plugin-fs');

                // Get fresh blob from backend (fixes header automatically)
                // Backend 'load_sse_document' handles header fix. 'readFile' gives raw.
                // We should probably rely on backend helper to get raw binary with %PDF fix, OR simple copy if header is compatible.
                // Let's use backend to get the blob (without PIN -> Unlocked=False => Censored)
                const base64Data = await invoke<string>('load_sse_document', {
                    filePath: item.file_path,
                    unlockPin: null
                });

                const byteCharacters = atob(base64Data);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                await writeFile(savePath, byteArray);

                this.resultModal = {
                    show: true,
                    title: 'Exportación Exitosa',
                    message: 'El documento protegido ha sido exportado. Mantendrá las reglas de seguridad originales.',
                    isError: false
                };
            }
        } catch (e) {
            console.error(e);
            this.resultModal = {
                show: true,
                title: 'Error',
                message: 'No se pudo exportar el archivo protegido.',
                isError: true
            };
        }
    }


    encryptionData = { pin: '', watermark: '', serviceUrl: '' };
    showEncryptionModal = false;
    isEncrypting = false;

    EncryptionConfig() {
        this.showExportModal = false;
        this.encryptionData = { pin: '', watermark: '', serviceUrl: '' };
        this.showEncryptionModal = true;
    }

    cancelEncryption() {
        this.showEncryptionModal = false;
        this.encryptionData = { pin: '', watermark: '', serviceUrl: '' };
    }

    async confirmEncryption() {
        if (!this.itemToExport) return;

        this.isEncrypting = true;
        try {
            // 1. Get Active Connection Base URL
            let baseUrl = 'https://127.0.0.1';
            try {
                const storedConn = localStorage.getItem('active_connection');
                if (storedConn) {
                    const conn = JSON.parse(storedConn);
                    if (conn && conn.url) baseUrl = conn.url;
                } else {
                    const connections = await invoke<any[]>('get_connections');
                    if (connections && connections.length > 0 && connections[0].url) {
                        baseUrl = connections[0].url;
                    }
                    console.log("Connections:", connections);
                }
            } catch (e) {
                console.warn("Could not determine active connection, using default", e);
            }

            if (!baseUrl) baseUrl = 'https://127.0.0.1';

            // Backend expects: /v1/api/makepdf/encrypt/{id}/{doc}
            const docId = this.itemToExport.id || ('doc_' + Date.now());
            const docType = 'PDF_Secure';

            const encryptUrl = `${baseUrl.replace(/\/$/, '')}/v1/api/makepdf/encrypt/${docId}/${docType}`;
            console.log("Encryption Service URL:", encryptUrl);

            // 2. Read File from Disk
            const { readFile } = await import('@tauri-apps/plugin-fs');
            const fileData = await readFile(this.itemToExport.file_path);
            const blob = new Blob([fileData], { type: 'application/pdf' });

            // 3. Prepare Form Data
            const formData = new FormData();
            formData.append('file', blob, this.itemToExport.file_name);
            if (this.encryptionData.pin) formData.append('pin', this.encryptionData.pin);
            if (this.encryptionData.watermark) formData.append('watermark', this.encryptionData.watermark);

            // 4. Send Request (Authorization usually handled by cookies or global interceptors if configured)
            // If LoggerService intercepts, ensure it doesn't block FormData.
            const response = await fetch(encryptUrl, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Server Error (${response.status}): ${errText}`);
            }

            // 5. Get Result
            const newPin = response.headers.get('X-Document-PIN');
            const resultBlob = await response.blob();
            const resultBuffer = await resultBlob.arrayBuffer();
            const resultUint8 = new Uint8Array(resultBuffer);

            // 6. Save File dialog
            this.showEncryptionModal = false;

            const { save } = await import('@tauri-apps/plugin-dialog');
            const savePath = await save({
                defaultPath: `SECURED_${this.itemToExport.file_name}`,
                filters: [{ name: 'Secure PDF', extensions: ['pdf'] }]
            });

            if (savePath) {
                const { writeFile } = await import('@tauri-apps/plugin-fs');
                await writeFile(savePath, resultUint8);

                this.resultModal = {
                    show: true,
                    title: 'Documento Cifrado Exitosamente',
                    message: `El archivo ha sido protegido y guardado.\n${newPin ? 'PIN Generado: ' + newPin : ''}`,
                    isError: false
                };
            }

        } catch (e: any) {
            console.error("Encryption Failed:", e);
            this.showEncryptionModal = false;
            this.resultModal = {
                show: true,
                title: 'Error de Cifrado',
                message: e.message || e.toString(),
                isError: true
            };
        } finally {
            this.isEncrypting = false;
        }
    }


    async deleteHistoryItem(item: any, event: Event) {
        event.stopPropagation();
        this.itemToDelete = item;
        this.showDeleteModal = true;
    }

    cancelDelete() {
        this.showDeleteModal = false;
        this.itemToDelete = null;
    }

    async confirmDelete() {
        if (!this.itemToDelete) return;

        try {
            // 1. Delete physical file if possible
            if (this.itemToDelete.file_path) {
                try {
                    const { remove } = await import('@tauri-apps/plugin-fs');
                    await remove(this.itemToDelete.file_path);
                    console.log("Archivo físico eliminado:", this.itemToDelete.file_path);
                } catch (fsErr) {
                    console.warn("No se pudo eliminar el archivo físico (puede que no exista o falten permisos):", fsErr);
                    // Continue to delete from DB anyway? Yes, to clean up ghost records.
                }
            }

            // 2. Delete from DB
            await invoke('delete_document_history', { id: this.itemToDelete.id });
            this.loadHistory();
        } catch (e) {
            console.error("Error deleting history:", e);
        } finally {
            this.showDeleteModal = false;
            this.itemToDelete = null;
        }
    }

    // Updated loadSecureDoc to pass null pin by default
    async loadSecureDoc(path: string, saveToHistory: boolean) {
        try {
            this.isLoading = true;
            this.error = null;

            console.log("Loading secure doc from:", path);

            // 1. Rust Call (Load & Decrypt in Memory) - No PIN (Locked view by default if protected)
            const base64Data = await invoke<string>('load_sse_document', {
                filePath: path,
                unlockPin: null // Explicitly null
            });

            // 2. Base64 -> Blob URL
            const byteCharacters = atob(base64Data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);

            // Determine if it is a PDF or SSE for icon
            // Check extension
            const isPdf = path.toLowerCase().endsWith('.pdf');
            const isSse = path.toLowerCase().endsWith('.sse');
            const iconClass = isPdf ? 'fas fa-file-pdf' : 'fas fa-file-shield';

            // 3. Open Logic
            const tabId = 'doc-' + Date.now();

            // Ensure Data URI format for download service
            const dataUri = base64Data.startsWith('data:')
                ? base64Data
                : `data:application/pdf;base64,${base64Data}`;

            this.appState.addTab({
                id: tabId,
                name: this.fileName,
                icon: iconClass,
                type: 'pdf-viewer',
                content: safeUrl,
                url: safeUrl,
                blobData: dataUri,
                originalName: this.fileName,
                filePath: path, // Critical for unlocking
                isProtected: isSse, // Only secure if extension is .sse
                isSavedToHistory: !saveToHistory,
                showToolbar: true,
                zoomLevel: 1.0
            });

            // 4. Save to History (Async)
            if (saveToHistory) {
                invoke('add_document_history', { fileName: this.fileName, filePath: path })
                    .then(() => this.loadHistory())
                    .catch(err => console.error("Error saving history:", err));
            }

            this.isLoading = false;
            this.fileName = '';

        } catch (e: any) {
            console.error("Error loading secure doc:", e);
            this.error = `Error: ${e}. El archivo puede haber sido movido o eliminado.`;
            this.isLoading = false;
        }
    }
}
