import { Component, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { invoke } from '@tauri-apps/api/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { AppStateService } from '../../core/services/app-state.service';
import { FileService } from '../../core/services/file.service';

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
    loadingFilePath: string | null = null; // Track which specific path is loading
    fileName: string = '';
    error: string | null = null;
    history: any[] = [];
    viewerActiveTab: 'global' | 'mailbox' = 'global';
    viewerSearchText: string = '';

    isDragging = false;
    certificationMap: Map<string, any> = new Map(); // Store certification info per path
    showCertificationModal = false;
    selectedCertification: any = null;
    isPendingValidation = false;
    pendingFileSelected: string | null = null;
    pendingFileResult: any = null;

    constructor(
        private sanitizer: DomSanitizer,
        private appState: AppStateService,
        private fileService: FileService
    ) {
        this.loadHistory();
    }

    async loadHistory() {
        try {
            this.history = await invoke('get_document_history');
            // Proactive verification for all history items to show badges
            this.history.forEach(item => {
                if (item.file_path) {
                    this.verifyDocumentCertification(item.file_path);
                }
            });
        } catch (e) {
            console.warn("Could not load history", e);
        }
    }

    get filteredHistory() {
        let list = this.history;

        // Filter by Tab (Global vs Mailbox)
        if (this.viewerActiveTab === 'global') {
            list = list.filter((d: any) => !d.source || d.source === 'GLOBAL');
        } else {
            list = list.filter((d: any) => d.source === 'MAILBOX');
        }

        // Search Filter
        if (this.viewerSearchText) {
            const lower = this.viewerSearchText.toLowerCase();
            list = list.filter((d: any) =>
                (d.file_name && d.file_name.toLowerCase().includes(lower)) ||
                (d.remote_code && d.remote_code.toLowerCase().includes(lower))
            );
        }

        return list;
    }

    getFileTypeConfig(fileName: string) {
        const ext = fileName.toLowerCase().split('.').pop() || '';
        
        const configs: { [key: string]: { icon: string, colorClass: string, isMascot?: boolean } } = {
            'pdf': { icon: 'far fa-file-pdf', colorClass: 'icon-pdf' },
            'csv': { icon: 'fas fa-file-csv', colorClass: 'icon-csv' },
            'xls': { icon: 'fas fa-file-excel', colorClass: 'icon-excel' },
            'xlsx': { icon: 'fas fa-file-excel', colorClass: 'icon-excel' },
            'zip': { icon: 'fas fa-file-archive', colorClass: 'icon-zip' },
            'rar': { icon: 'fas fa-file-archive', colorClass: 'icon-zip' },
            '7z': { icon: 'fas fa-file-archive', colorClass: 'icon-zip' },
            'sse': { icon: '', colorClass: '', isMascot: true },
            'png': { icon: 'fas fa-file-image', colorClass: 'icon-img' },
            'jpg': { icon: 'fas fa-file-image', colorClass: 'icon-img' },
            'jpeg': { icon: 'fas fa-file-image', colorClass: 'icon-img' },
            'txt': { icon: 'fas fa-file-alt', colorClass: 'icon-txt' },
        };

        return configs[ext] || { icon: 'fas fa-shield-alt', colorClass: 'icon-protected' };
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
            this.appState.setGlobalLoading(true, "Iniciando explorador de archivos...");
            
            const { open } = await import('@tauri-apps/plugin-dialog');

            const selected = await open({
                multiple: false,
                filters: [{
                    name: 'Bunker Documents',
                    extensions: ['sse', 'pdf', 'gpg', 'pgp', 'csv', 'txt', 'xlsx', 'xls', 'png', 'jpg', 'jpeg']
                }]
            });

            // Una vez que el explorador se cierra, quitamos el global loading inicial
            this.appState.setGlobalLoading(false);

            if (selected && typeof selected === 'string') {
                this.fileName = selected.split(/[\\/]/).pop() || selected;
                this.loadingFilePath = selected; // Mark this as the one loading
                
                // --- PROACTIVE ALCHEMY VALIDATION ---
                try {
                    const result = await invoke<any>('verify_file_seal', { filePath: selected });
                    if (result && result.status === 'VALID') {
                        this.pendingFileSelected = selected;
                        this.pendingFileResult = result;
                        this.selectedCertification = result;
                        this.selectedCertification.fileName = this.fileName;
                        this.isPendingValidation = true;
                        this.showCertificationModal = true;
                        this.isLoading = false;
                        this.loadingFilePath = null;
                        return;
                    }
                } catch (certErr) {
                    console.warn("Initial cert check skipped/failed", certErr);
                }

                if (selected.toLowerCase().endsWith('.gpg') || selected.toLowerCase().endsWith('.pgp')) {
                    this.isLoading = false;
                    this.loadingFilePath = null;
                    this.gpgUnlockFilePath = selected;
                    this.gpgUnlockFileName = this.fileName;
                    this.gpgUnlockSaveToHistory = true;
                    this.showGpgUnlockModal = true;
                } else {
                    // Small timeout to allow UI to paint loading state before blocking processing
                    setTimeout(async () => {
                        await this.loadSecureDoc(selected, true);
                        this.loadingFilePath = null;
                    }, 50);
                }
            } else {
                this.isLoading = false;
                this.loadingFilePath = null;
            }
        } catch (e) {
            console.error(e);
            this.appState.setGlobalLoading(false);
            this.error = "Error al abrir diálogo.";
            this.isLoading = false;
            this.loadingFilePath = null;
        }
    }

    async openFromHistory(item: any) {
        if (this.isLoading || this.loadingFilePath) return;

        this.fileName = item.file_name;
        this.loadingFilePath = item.file_path;
        this.isLoading = true;

        if (item.file_name.toLowerCase().endsWith('.gpg') || item.file_name.toLowerCase().endsWith('.pgp')) {
            this.isLoading = false;
            this.loadingFilePath = null;
            this.gpgUnlockFilePath = item.file_path;
            this.gpgUnlockFileName = this.fileName;
            this.gpgUnlockSaveToHistory = false;
            this.showGpgUnlockModal = true;
        } else {
            // High visibility loading for history
            this.appState.setGlobalLoading(true, `Abriendo ${this.fileName}...`);
            
            setTimeout(async () => {
                await this.loadSecureDoc(item.file_path, false);
                // Re-verify certification as well
                this.verifyDocumentCertification(item.file_path);
                this.loadingFilePath = null;
                this.appState.setGlobalLoading(false);
            }, 100);
        }
    }

    async verifyDocumentCertification(path: string) {
        try {
            const result = await invoke<any>('verify_file_seal', { filePath: path });
            if (result && result.status === 'VALID') {
                this.certificationMap.set(path, result);
                console.log("Certification found for:", path, result);
            } else {
                this.certificationMap.delete(path);
            }
        } catch (e) {
            console.warn("Cert verify failed", e);
            this.certificationMap.delete(path);
        }
    }

    openCertificationDetails(item: any, event: Event) {
        event.stopPropagation();
        const cert = this.certificationMap.get(item.file_path);
        if (cert) {
            this.selectedCertification = cert;
            this.selectedCertification.fileName = item.file_name;
            this.showCertificationModal = true;
        }
    }

    closeCertificationModal() {
        this.showCertificationModal = false;
        this.selectedCertification = null;
        this.isPendingValidation = false;
        this.pendingFileSelected = null;
        this.pendingFileResult = null;
    }

    async confirmAttachment() {
        if (!this.pendingFileSelected) return;
        
        const path = this.pendingFileSelected;
        const result = this.pendingFileResult;
        
        // 1. Mark as certified so the badge appears
        this.certificationMap.set(path, result);
        
        // 2. Clear pendings
        this.isPendingValidation = false;
        this.showCertificationModal = false;
        
        // 3. Proceed to load/encrypt/save to history
        if (path.toLowerCase().endsWith('.gpg') || path.toLowerCase().endsWith('.pgp')) {
            this.gpgUnlockFilePath = path;
            this.gpgUnlockFileName = this.fileName;
            this.gpgUnlockSaveToHistory = true;
            this.showGpgUnlockModal = true;
        } else {
            await this.loadSecureDoc(path, true);
        }
        
        this.pendingFileSelected = null;
        this.pendingFileResult = null;
    }

    cancelAttachment() {
        this.closeCertificationModal();
        this.isLoading = false;
        this.fileName = '';
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
    gpgUnlockSaveToHistory: boolean = true;

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

    unlockGpgExport() {
        this.showExportModal = false;
        // Re-use logic: act as if they clicked to open it from history (won't duplicate history)
        this.openFromHistory(this.itemToExport);
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
                defaultPath: item.file_name.toLowerCase().endsWith('.sse') ? item.file_name : item.file_name.replace(/\.pdf$/i, '.sse'),
                filters: [
                    { name: 'Bunker Encrypted Document', extensions: ['sse'] },
                    { name: 'PDF Document', extensions: ['pdf'] }
                ]
            });

            if (savePath) {
                const { readFile, writeFile } = await import('@tauri-apps/plugin-fs');

                // Get fresh blob from backend (fixes header automatically)
                const base64Data = await invoke<string>('load_sse_document', {
                    filePath: item.file_path,
                    unlockPin: null
                });

                // --- APPLY ALQUIMIA SEAL BEFORE SAVING ---
                const sealedBytes = await invoke<number[]>('apply_alquimia_seal', {
                    fileName: item.file_name,
                    pdfBase64: base64Data,
                    metadata: { name: "Usuario Sandra" } // In a real scenario, use actual user name
                });

                await writeFile(savePath, new Uint8Array(sealedBytes));

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

    // --- GPG Logic ---
    showGpgEncryptionModal = false;
    isGpgEncrypting = false;
    gpgData = { passphrase: '', confirmPassphrase: '' };
    showGpgPassword = false;

    showGpgUnlockModal = false;
    gpgUnlockPassphrase = '';
    gpgUnlockFilePath = '';
    gpgUnlockFileName = '';
    showGpgUnlockPassword = false;

    EncryptionGpgConfig() {
        this.showExportModal = false;
        this.gpgData = { passphrase: '', confirmPassphrase: '' };
        this.showGpgPassword = false;
        this.showGpgEncryptionModal = true;
    }

    cancelGpgEncryption() {
        this.showGpgEncryptionModal = false;
        this.gpgData = { passphrase: '', confirmPassphrase: '' };
        this.showGpgPassword = false;
    }

    async confirmGpgEncryption() {
        if (!this.itemToExport || !this.gpgData.passphrase) return;
        if (this.gpgData.passphrase !== this.gpgData.confirmPassphrase) return;

        this.isGpgEncrypting = true;
        this.appState.setGlobalLoading(true, 'Cifrando GPG, por favor espere...');

        try {
            // First, load the document content as Base64 (unlocked if SSE, pure if PDF)
            const base64Data = await invoke<string>('load_sse_document', {
                filePath: this.itemToExport.file_path,
                unlockPin: null
            });

            const rawByteCharacters = atob(base64Data);
            const rawByteNumbers = new Array(rawByteCharacters.length);
            for (let i = 0; i < rawByteCharacters.length; i++) {
                rawByteNumbers[i] = rawByteCharacters.charCodeAt(i);
            }
            const inputByteArray = new Uint8Array(rawByteNumbers);

            // Send to Rust to encrypt using native binary array
            const gpgArray = await invoke<number[]>('encrypt_gpg_symmetric_raw', {
                inputData: Array.from(inputByteArray),
                passphrase: this.gpgData.passphrase
            });

            const byteArray = new Uint8Array(gpgArray);

            this.showGpgEncryptionModal = false;
            const { save } = await import('@tauri-apps/plugin-dialog');
            let baseName = this.itemToExport.file_name;
            // Quitamos la extension para no dejar basura como .pdf.gpg si el usuario lo desea.
            // Aunque si tenia .txt o .csv podemos dejarlo, pero según la lógica Magic Bytes ya no es necesario.
            baseName = baseName.replace(/\.[^/.]+$/, "");

            const savePath = await save({
                defaultPath: `${baseName}.gpg`,
                filters: [{ name: 'GPG Document', extensions: ['gpg', 'pgp'] }]
            });

            if (savePath) {
                const { writeFile } = await import('@tauri-apps/plugin-fs');
                await writeFile(savePath, byteArray);
                this.resultModal = {
                    show: true,
                    title: 'Documento Cifrado Exitosamente',
                    message: `El archivo ha sido protegido con GPG y guardado.`,
                    isError: false
                };
            }
        } catch (e: any) {
            console.error("GPG Encryption Failed:", e);
            this.showGpgEncryptionModal = false;
            this.resultModal = { show: true, title: 'Error de Cifrado', message: e.toString(), isError: true };
        } finally {
            this.isGpgEncrypting = false;
            this.appState.setGlobalLoading(false);
        }
    }

    cancelGpgUnlock() {
        this.showGpgUnlockModal = false;
        this.gpgUnlockPassphrase = '';
        this.gpgUnlockFilePath = '';
        this.isLoading = false;
    }

    async submitGpgUnlock() {
        if (!this.gpgUnlockPassphrase) return;
        this.isLoading = true;
        try {
            const rawArray = await invoke<number[]>('decrypt_gpg_symmetric_file_raw', {
                filePath: this.gpgUnlockFilePath,
                passphrase: this.gpgUnlockPassphrase
            });

            this.showGpgUnlockModal = false;
            this.gpgUnlockPassphrase = '';

            const byteArray = new Uint8Array(rawArray);

            // Base64 conversion needed for blobData prefix if used inside history saving
            let binaryString = '';
            for (let i = 0; i < Math.min(byteArray.byteLength, 100000); i++) {
                binaryString += String.fromCharCode(byteArray[i]);
            }
            // For huge files, btoa on a giant string can crash the V8 engine, but we only strictly need it for `blobData` dataUri.
            // A more robust way:
            const base64Data = btoa(
                new Uint8Array(byteArray).reduce(
                    (data, byte) => data + String.fromCharCode(byte),
                    ''
                )
            );

            // MAGIC BYTES DETECTION
            let mimeType = 'application/octet-stream';
            let viewerType: any = 'file-viewer';
            let ext = '.bin';

            if (byteArray.length >= 4 && byteArray[0] === 0x25 && byteArray[1] === 0x50 && byteArray[2] === 0x44 && byteArray[3] === 0x46) {
                mimeType = 'application/pdf'; ext = '.pdf'; viewerType = 'pdf-viewer';
            } else if (byteArray.length >= 8 && byteArray[0] === 0x89 && byteArray[1] === 0x50 && byteArray[2] === 0x4E && byteArray[3] === 0x47) {
                mimeType = 'image/png'; ext = '.png';
            } else if (byteArray.length >= 3 && byteArray[0] === 0xFF && byteArray[1] === 0xD8 && byteArray[2] === 0xFF) {
                mimeType = 'image/jpeg'; ext = '.jpg';
            } else if (byteArray.length >= 4 && byteArray[0] === 0x50 && byteArray[1] === 0x4B && byteArray[2] === 0x03 && byteArray[3] === 0x04) {
                mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; ext = '.xlsx';
            } else {
                let isBinary = false;
                let hasComma = false;
                for (let i = 0; i < Math.min(byteArray.length, 500); i++) {
                    if (byteArray[i] === 0) { isBinary = true; break; }
                    if (byteArray[i] === 0x2C || byteArray[i] === 0x3B) hasComma = true;
                }
                if (!isBinary) {
                    if (hasComma) { mimeType = 'text/csv'; ext = '.csv'; }
                    else { mimeType = 'text/plain'; ext = '.txt'; }
                }
            }

            let cleanNameOriginal = this.gpgUnlockFileName.replace(/\.gpg$/i, '').replace(/\.pgp$/i, '');
            // Append the proper extension if it was lost
            if (!cleanNameOriginal.toLowerCase().endsWith(ext)) {
                cleanNameOriginal += ext;
            }

            const blob = new Blob([byteArray], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);

            const tabId = 'doc-' + Date.now();
            let dataUriPrefix = `data:${mimeType};base64,`;
            const dataUri = base64Data.startsWith('data:') ? base64Data : `${dataUriPrefix}${base64Data}`;

            this.appState.addTab({
                id: tabId,
                name: cleanNameOriginal,
                icon: 'fas fa-key',
                type: viewerType,
                content: safeUrl,
                url: safeUrl,
                blobData: dataUri,
                originalName: cleanNameOriginal,
                filePath: this.gpgUnlockFilePath,
                isProtected: false,
                isSavedToHistory: true,
                showToolbar: true,
                zoomLevel: 1.0,
                mimeType: mimeType,
                csvHeader: [],
                csvRows: []
            });

            if (mimeType === 'text/csv') {
                const { header, rows } = await this.fileService.parseCSV(blob);
                const tabs = this.appState.getTabsSnapshot();
                const lastTab = tabs[tabs.length - 1];
                if (lastTab && lastTab.id === tabId) {
                    lastTab.type = 'csv-viewer';
                    lastTab.csvHeader = header;
                    lastTab.csvRows = rows;
                    lastTab.icon = 'fas fa-table';
                }
            }

            if (this.gpgUnlockSaveToHistory) {
                // Calculate hash for GPG unlocked file (or use path)
                const fileHash = await invoke<string>('sha256_hash_file', { filePath: this.gpgUnlockFilePath });
                
                invoke('add_document_history', { 
                    fileName: this.gpgUnlockFileName, 
                    filePath: this.gpgUnlockFilePath,
                    fileSize: 'Locked',
                    remoteCode: '',
                    source: 'GLOBAL',
                    fileHash: fileHash
                })
                    .then(() => this.loadHistory())
                    .catch(err => console.error("Error saving history:", err));
            }

        } catch (e: any) {
            console.error("GPG Unlock Error:", e);
            this.resultModal = { show: true, title: 'Error GPG', message: 'Contraseña incorrecta o archivo inválido.', isError: true };
        } finally {
            this.isLoading = false;
        }
    }

    // --- End GPG Logic ---

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
        this.appState.setGlobalLoading(true, 'Empaquetando en bóveda segura...');

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
            this.appState.setGlobalLoading(false);
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

            // Use global loading for the heavy part
            this.appState.setGlobalLoading(true, "Desencriptando en memoria RAM...");

            // 1. Rust Call (Load & Decrypt in Memory) - No PIN (Locked view by default if protected)
            const base64Data = await invoke<string>('load_sse_document', {
                filePath: path,
                unlockPin: null // Explicitly null
            });

            const cleanName = path.toLowerCase();
            let mimeType = 'application/pdf';
            let viewerType: any = 'pdf-viewer';
            let dataUriPrefix = 'data:application/pdf;base64,';
            let iconClass = 'fas fa-file-pdf';
        let fileSize = '0 KB';
        let remoteCode = '';

            if (cleanName.endsWith('.csv')) { mimeType = 'text/csv'; viewerType = 'file-viewer'; dataUriPrefix = 'data:text/csv;base64,'; iconClass = 'fas fa-file-csv'; }
            else if (cleanName.endsWith('.txt')) { mimeType = 'text/plain'; viewerType = 'file-viewer'; dataUriPrefix = 'data:text/plain;base64,'; iconClass = 'fas fa-file-alt'; }
            else if (cleanName.endsWith('.png')) { mimeType = 'image/png'; viewerType = 'file-viewer'; dataUriPrefix = 'data:image/png;base64,'; iconClass = 'fas fa-file-image'; }
            else if (cleanName.endsWith('.jpg') || cleanName.endsWith('.jpeg')) { mimeType = 'image/jpeg'; viewerType = 'file-viewer'; dataUriPrefix = 'data:image/jpeg;base64,'; iconClass = 'fas fa-file-image'; }
            else if (cleanName.endsWith('.xlsx') || cleanName.endsWith('.xls')) { mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; viewerType = 'file-viewer'; dataUriPrefix = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,'; iconClass = 'fas fa-file-excel'; }

            const byteCharacters = atob(base64Data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
            fileSize = (byteArray.length / 1024).toFixed(1) + ' KB';
            remoteCode = ''; // Not available here

            const isSse = cleanName.endsWith('.sse');
            let csvHeaders: string[] = [];
            let csvRows: string[][] = [];

            if (cleanName.endsWith('.csv')) {
                const { header, rows } = await this.fileService.parseCSV(blob);
                if (header.length > 0) {
                    csvHeaders = header;
                    csvRows = rows;
                    viewerType = 'csv-viewer';
                    mimeType = 'text/csv';
                    iconClass = 'fas fa-table';
                }
            }

            if (isSse || cleanName.endsWith('.pdf')) {
                iconClass = isSse ? 'fas fa-file-shield' : 'fas fa-file-pdf';
                viewerType = 'pdf-viewer';
            }

            const tabId = 'doc-' + Date.now();
            const dataUri = base64Data.startsWith('data:') ? base64Data : `${dataUriPrefix}${base64Data}`;

            this.appState.addTab({
                id: tabId,
                name: this.fileName,
                icon: iconClass,
                type: viewerType,
                content: safeUrl,
                url: safeUrl,
                blobData: dataUri,
                originalName: this.fileName,
                filePath: path, // Critical for unlocking
                isProtected: isSse, // Only secure if extension is .sse
                isSavedToHistory: !saveToHistory,
                showToolbar: true,
                zoomLevel: 1.0,
                mimeType: mimeType,
                csvHeader: csvHeaders,
                csvRows: csvRows
            });

            // 4. Save to History (Async)
            if (saveToHistory) {
                const fileHash = await invoke<string>('sha256_hash_file', { filePath: path });

                invoke('add_document_history', { 
                    fileName: this.fileName, 
                    filePath: path,
                    fileSize: fileSize,
                    remoteCode: remoteCode,
                    source: 'GLOBAL',
                    fileHash: fileHash
                })
                    .then(() => this.loadHistory())
                    .catch(err => console.error("Error saving history:", err));
            }

            this.isLoading = false;
            this.loadingFilePath = null;
            this.fileName = '';
            this.appState.setGlobalLoading(false);

            // Verify Certification
            this.verifyDocumentCertification(path);

        } catch (e: any) {
            console.error("Error loading secure doc:", e);
            this.error = `Error: ${e}. El archivo puede haber sido movido o eliminado.`;
            this.isLoading = false;
            this.loadingFilePath = null;
            this.appState.setGlobalLoading(false);
        }
    }
}
