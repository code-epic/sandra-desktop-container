import { Component, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { AppStateService } from '../../core/services/app-state.service';
import { FileService } from '../../core/services/file.service';
import { SecurityService } from '../../core/services/security.service';

@Component({
    selector: 'app-secure-viewer',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './secure-viewer.component.html',
    styleUrls: ['./secure-viewer.component.css']
})
export class SecureViewerComponent {
    @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

    // Manuals Interface Mapping
    showManualDetailsModal = false;
    selectedManual: any = null;

    isLoading = false;
    loadingFilePath: string | null = null; // Track which specific path is loading
    fileName: string = '';
    error: string | null = null;
    history: any[] = [];
    viewerActiveTab: 'global' | 'mailbox' | 'manuals' = 'global';
    private _viewerSearchText: string = '';
    get viewerSearchText() { return this._viewerSearchText; }
    set viewerSearchText(val: string) {
        this._viewerSearchText = val;
        this.updateGroupedHistory();
    }

    isDragging = false;
    certificationMap: Map<string, any> = new Map(); // Store certification info per path
    showCertificationModal = false;
    selectedCertification: any = null;
    isPendingValidation = false;
    pendingFileSelected: string | null = null;
    pendingFileResult: any = null;

    // View state for current document
    docUrl: SafeResourceUrl | null = null;
    viewerType: string = '';
    currentMimeType: string = '';

    constructor(
        private sanitizer: DomSanitizer,
        private appState: AppStateService,
        private fileService: FileService,
        private securityService: SecurityService // Inyectado para obtener user_login
    ) {
        this.loadHistory();
        this.setupListeners();
    }

    setTab(tab: 'global' | 'mailbox' | 'manuals') {
        console.log("[SecureViewer] Cambiando a tab:", tab);
        this.viewerActiveTab = tab;
        this.updateGroupedHistory();

        // Auto-sync manuals if switching to that tab and empty? 
        // Or just let the user refresh. Let's do a proactive check.
        if (tab === 'manuals' && (this.filteredHistory?.length === 0 || !this.filteredHistory)) {
            console.log("[SecureViewer] Tab Manuales detectado vacío, listo para sincronizar");
            // this.syncManuals(); // Optional: Auto-sync
        }
    }

    async syncManuals() {
        console.log("[SecureViewer] syncManuals() trigger iniciado");
        try {
            // 1. Intentar obtener del servicio (Sesión activa en memoria)
            let activeConn = this.securityService.activeSyncConnection;
            let author = this.securityService.activeSyncAuthor;

            console.log("[SecureViewer] Estado inicial del servicio:", {
                hasConn: !!activeConn,
                hasAuthor: !!author
            });

            // 2. Fallback a localStorage si el servicio perdió el estado
            if (!activeConn || !author) {
                console.log("[SecureViewer] El servicio no tiene sesión activa, intentando fallback a localStorage...");
                const activeConnStr = localStorage.getItem('active_connection');
                const authorStr = localStorage.getItem('author_profile');

                if (activeConnStr) activeConn = JSON.parse(activeConnStr);
                if (authorStr) author = JSON.parse(authorStr);
            }

            // 3. Fallback final: Intentar reconstruir autor desde JWT si tenemos conexión
            if (activeConn && !author) {
                console.log("[SecureViewer] Reconstruyendo perfil desde JWT...");
                const login = this.securityService.getCurrentUserLogin();
                author = { usuario: login, sistema: 'consola' };
            }

            if (!activeConn?.hash || !author?.usuario) {
                console.warn("[SecureViewer] Sincronización cancelada: No se encontró sesión válida en Memoria ni Storage", {
                    activeConn: !!activeConn?.hash,
                    author: !!author?.usuario
                });
                this.error = "No hay sesión de seguridad activa. Por favor, re-conecte su terminal.";
                return;
            }

            console.log("[SecureViewer] Iniciando sincronización con:", {
                host: activeConn.ip_address,
                user: author.usuario
            });

            await this.securityService.startManualsSync(activeConn, author);
            console.log("[SecureViewer] Sincronización de manuales enviada al servicio.");
        } catch (e) {
            console.error("[SecureViewer] Error crítico en syncManuals:", e);
        }
    }

    async setupListeners() {
        await listen('refresh-document-history', () => {
            this.loadHistory();
        });
    }

    async loadHistory() {
        try {
            const login = this.securityService.getCurrentUserLogin();
            console.log("[SecureViewer] Cargando historial para usuario:", login);

            this.history = await invoke('get_document_history', { userLogin: login });
            console.log("[SecureViewer] Historial recuperado de SQLite:", this.history);

            // Trigger lazy verification for history items
            this.history.forEach(doc => {
                if (doc.file_path) this.verifyDocumentCertification(doc.file_path);
            });
            this.updateGroupedHistory();
        } catch (e) {
            console.warn("[SecureViewer] Error cargando historial desde vault", e);
        }
    }

    get filteredHistory() {
        let list = this.history;

        // Filter by Tab (Global vs Mailbox vs Manuals)
        if (this.viewerActiveTab === 'global') {
            list = list.filter((d: any) => !d.source || d.source === 'GLOBAL');
        } else if (this.viewerActiveTab === 'mailbox') {
            list = list.filter((d: any) => d.source === 'MAILBOX');
        } else if (this.viewerActiveTab === 'manuals') {
            list = list.filter((d: any) => d.source === 'MANUALS');
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

    // New state for folders
    openFolders = new Set<string>();

    // Stable grouped list
    groupedHistory: any[] = [];

    updateGroupedHistory() {
        const list = this.filteredHistory;
        const result: any[] = [];
        const groupsMap = new Map<string, any>();

        list.forEach((item: any) => {
            if (item.group_name) {
                if (!groupsMap.has(item.group_name)) {
                    const group = {
                        isFolder: true,
                        name: item.group_name,
                        items: [],
                        opened_at: item.opened_at,
                        isOpen: this.openFolders.has(item.group_name)
                    };
                    groupsMap.set(item.group_name, group);
                    result.push(group);
                }
                groupsMap.get(item.group_name).items.push(item);
            } else {
                // Keep original reference for trackBy to work best
                result.push({ ...item, isFolder: false });
            }
        });

        this.groupedHistory = result;
    }

    trackByEntry(index: number, entry: any) {
        if (entry.isFolder) return 'folder-' + entry.name;
        return 'file-' + (entry.id || entry.file_path);
    }

    trackBySubItem(index: number, item: any) {
        return item.id || item.file_path;
    }

    toggleFolder(groupName: string, event: Event) {
        event.stopPropagation();
        if (this.openFolders.has(groupName)) {
            this.openFolders.delete(groupName);
        } else {
            this.openFolders.add(groupName);
        }
        this.updateGroupedHistory();
    }

    async deleteFolder(folderName: string, event: Event) {
        event.stopPropagation();
        if (this.viewerActiveTab === 'manuals') {
            console.warn("[Security] Bloqueo de eliminación: Las carpetas de manuales no pueden ser borradas.");
            return;
        }
        this.folderToDeleteName = folderName;
        this.showFolderDeleteModal = true;
    }

    cancelFolderDelete() {
        this.showFolderDeleteModal = false;
        this.folderToDeleteName = null;
    }

    async confirmFolderDelete() {
        if (!this.folderToDeleteName) return;
        this.securityService.playDeleteSound();
        try {
            this.appState.setGlobalLoading(true, "Eliminando grupo de documentos...");
            await invoke('delete_document_group', { groupName: this.folderToDeleteName });
            this.openFolders.delete(this.folderToDeleteName); // Limpiar estado de apertura
            await this.loadHistory();
        } catch (err) {
            console.error("Error deleting folder:", err);
        } finally {
            this.appState.setGlobalLoading(false);
            this.showFolderDeleteModal = false;
            this.folderToDeleteName = null;
        }
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
            this.appState.setViewerLoading(true);
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
            this.appState.setViewerLoading(false);

            if (selected && typeof selected === 'string') {
                this.fileName = selected.split(/[\\/]/).pop() || selected;
                this.loadingFilePath = selected; // Mark this as the one loading
                this.appState.setViewerLoading(true); // Re-activate for the actual processing

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
                        this.appState.setViewerLoading(false);
                        return;
                    }
                } catch (certErr) {
                    console.warn("Initial cert check skipped/failed", certErr);
                }

                if (selected.toLowerCase().endsWith('.gpg') || selected.toLowerCase().endsWith('.pgp')) {
                    this.isLoading = false;
                    this.loadingFilePath = null;
                    this.appState.setViewerLoading(false);
                    this.gpgUnlockFilePath = selected;
                    this.gpgUnlockFileName = this.fileName;
                    this.gpgUnlockSaveToHistory = true;
                    this.showGpgUnlockModal = true;
                } else {
                    // Small timeout to allow UI to paint loading state before blocking processing
                    setTimeout(async () => {
                        await this.loadSecureDoc(selected, true);
                        this.loadingFilePath = null;
                        this.appState.setViewerLoading(false);
                    }, 50);
                }
            } else {
                this.isLoading = false;
                this.loadingFilePath = null;
                this.appState.setViewerLoading(false);
            }
        } catch (e) {
            console.error(e);
            this.appState.setGlobalLoading(false);
            this.error = "Error al abrir diálogo.";
            this.isLoading = false;
            this.loadingFilePath = null;
            this.appState.setViewerLoading(false);
        }
    }

    async openFromHistory(item: any) {
        if (this.isLoading || this.loadingFilePath) return;

        // Restriction: Manuals use remote CDN path
        if (item.source === 'MANUALS') {
            await this.openRemoteManual(item);
            return;
        }

        this.fileName = item.file_name;
        this.loadingFilePath = item.file_path;
        this.isLoading = true;
        this.appState.setViewerLoading(true);

        if (item.file_name.toLowerCase().endsWith('.gpg') || item.file_name.toLowerCase().endsWith('.pgp')) {
            this.isLoading = false;
            this.loadingFilePath = null;
            this.appState.setViewerLoading(false);
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
                this.appState.setViewerLoading(false);
            }, 100);
        }
    }

    async openRemoteManual(item: any) {
        try {
            const activeConn = this.securityService.activeSyncConnection;
            if (!activeConn || !activeConn.hash) {
                this.error = "No hay conexión activa para descargar el manual.";
                return;
            }

            this.fileName = item.file_name;
            this.loadingFilePath = item.file_path;
            this.isLoading = true;
            this.appState.setViewerLoading(true);
            this.appState.setGlobalLoading(true, "Descargando manual desde el nodo seguro...");

            const endpoint = `v1/api/dwscdn/${encodeURIComponent(item.group_name)}/${encodeURIComponent(item.file_name)}`;

            console.log("[SecureViewer] Descargando manual remoto via Tauri API:", endpoint);

            // Bypassing browser fetch to avoid CORS/Preflight 405 and inclusion of security headers
            const binaryData = await invoke<number[]>('api_get_binary_request', {
                ip: activeConn.ip_address,
                port: Number(activeConn.port),
                endpoint: endpoint,
                hash: activeConn.hash,
                tempAuthToken: activeConn.jwt
            });

            const byteArray = new Uint8Array(binaryData);
            const blob = new Blob([byteArray], { type: 'application/pdf' });
            const blobUrl = URL.createObjectURL(blob) + '#toolbar=0&navpanes=0';
            const safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(blobUrl);

            this.docUrl = safeUrl;
            this.viewerType = 'pdf-viewer';
            this.currentMimeType = 'application/pdf';

            // Add to App Tabs
            const tabId = 'manual-' + item.id + '-' + Date.now();
            this.appState.addTab({
                id: tabId,
                name: item.file_name,
                icon: 'fas fa-book',
                type: 'pdf-viewer',
                content: safeUrl,
                url: safeUrl,
                originalName: item.file_name,
                filePath: endpoint,
                isProtected: false,
                isSavedToHistory: true, // Already in history
                showToolbar: true,
                zoomLevel: 1.0,
                mimeType: 'application/pdf',
                source: 'MANUALS'
            });

            // Re-verify certification if possible
            this.verifyDocumentCertification(item.file_path);

        } catch (e) {
            console.error("Error opening remote manual:", e);
            this.error = "No se pudo descargar el manual del servidor central.";
        } finally {
            this.isLoading = false;
            this.loadingFilePath = null;
            this.appState.setGlobalLoading(false);
            this.appState.setViewerLoading(false);
        }
    }

    openManualDetails(item: any, event: Event) {
        event.stopPropagation();
        if (item.metadata) {
            try {
                this.selectedManual = JSON.parse(item.metadata);
                this.showManualDetailsModal = true;
            } catch (e) {
                console.error("Error parsing manual metadata:", e);
            }
        }
    }

    closeManualDetails() {
        this.showManualDetailsModal = false;
        this.selectedManual = null;
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
    showFolderDeleteModal = false;
    itemToDelete: any = null;
    folderToDeleteName: string | null = null;

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

            let csvHeaders: string[] = [];
            let csvRows: string[][] = [];
            if (ext === '.csv') {
                try {
                    const { header, rows } = await this.fileService.parseCSV(blob);
                    if (header.length > 0) {
                        csvHeaders = header;
                        csvRows = rows;
                        viewerType = 'csv-viewer';
                    }
                } catch (e) {
                    console.error("CSV parse error in GPG", e);
                }
            }

            let txtContent: string | undefined = undefined;
            let txtLines: string[] | undefined = undefined;
            let txtTotalLines: number | undefined = undefined;
            let txtIsTruncated = false;

            if (ext === '.txt') {
                this.appState.setGlobalLoading(true, "Cargando documento de texto...");
                try {
                    const fullText = await blob.text();
                    txtLines = fullText.split(/\r?\n/);
                    txtTotalLines = txtLines.length;

                    if (txtLines.length > 1000) {
                        txtIsTruncated = true;
                        console.log(`⚡ [Performance] Archivo de texto grande (${txtTotalLines} lineas). Truncando vista a 1000...`);
                        txtContent = txtLines.slice(0, 1000).join("\n");
                    } else {
                        txtContent = fullText;
                    }
                } catch (txtErr) {
                    console.error("Error reading text content:", txtErr);
                } finally {
                    this.appState.setGlobalLoading(false);
                }
            }

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
                csvHeader: csvHeaders,
                csvRows: csvRows,
                txtContent,
                txtLines,
                txtTotalLines,
                txtIsTruncated
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
                    fileHash: fileHash,
                    userLogin: this.securityService.getCurrentUserLogin()
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
        if (this.viewerActiveTab === 'manuals' || item.source === 'MANUALS') {
            console.warn("[Security] Bloqueo de eliminación: Los manuales no pueden ser borrados.");
            return;
        }
        this.itemToDelete = item;
        this.showDeleteModal = true;
    }

    cancelDelete() {
        this.showDeleteModal = false;
        this.itemToDelete = null;
    }

    async confirmDelete() {
        if (!this.itemToDelete) return;
        this.securityService.playDeleteSound();
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

            let txtContent: string | undefined = undefined;
            let txtLines: string[] | undefined = undefined;
            let txtTotalLines: number | undefined = undefined;
            let txtIsTruncated = false;

            if (cleanName.endsWith('.txt')) {
                this.appState.setGlobalLoading(true, "Cargando documento de texto...");
                try {
                    const fullText = await blob.text();
                    txtLines = fullText.split(/\r?\n/);
                    txtTotalLines = txtLines.length;

                    if (txtLines.length > 1000) {
                        txtIsTruncated = true;
                        console.log(`⚡ [Performance] Archivo de texto grande (${txtTotalLines} lineas). Truncando vista a 1000...`);
                        txtContent = txtLines.slice(0, 1000).join("\n");
                    } else {
                        txtContent = fullText;
                    }
                } catch (txtErr) {
                    console.error("Error reading text content:", txtErr);
                } finally {
                    this.appState.setGlobalLoading(false);
                }
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
                csvRows: csvRows,
                txtContent,
                txtLines,
                txtTotalLines,
                txtIsTruncated,
                source: saveToHistory ? 'GLOBAL' : (path.startsWith('http') ? 'MANUALS' : 'HISTORY') // Simple detection
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
                    fileHash: fileHash,
                    userLogin: this.securityService.getCurrentUserLogin()
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
