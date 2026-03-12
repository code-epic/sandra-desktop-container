import { Component, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import {
  SecurityService,
  MailboxMessage,
  SecurityConfig,
  ProxyRoute
} from '../../core/services/security.service';
import { AppStateService } from '../../core/services/app-state.service';
import { FileService } from '../../core/services/file.service';
import { SdcService } from '../../core/services/sdc.service';
import { readFile } from '@tauri-apps/plugin-fs';

// Interfaz para la configuración de acceso
interface SdcConfig {
  access: {
    jwtStorage: 'localStorage' | 'sessionStorage';
    jwtVariableName: string;
  };
}

@Component({
  selector: 'app-security',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './security.component.html',
  styleUrls: ['./security.component.css'],
})
export class SecurityComponent implements OnInit {
  @Input() activeConnection: any;

  activeTab: 'mailbox' | 'config' | 'proxy' = 'mailbox';
  currentMailbox: 'Red' | 'Entrada' | 'Salida' | 'Config' | 'Boveda' = 'Entrada';
  history: any[] = [];

  // Mailbox Data
  messages: MailboxMessage[] = [];
  selectedMessage: MailboxMessage | null = null;
  highlightedMessage: MailboxMessage | null = null;
  parsedContent: any = null;
  mailboxDirection: 'inbox' | 'outbox' = 'inbox'; // Novedad: Bandeja de entrada o salida

  // Estado del Autor
  currentAuthorName: string = 'E. Admin (Sandra)';
  showTrace: boolean = false;
  isComposing: boolean = false;
  searchText: string = ''; // Renamed from searchTerm
  statusFilter: string = '';
  selectedIds: Set<number> = new Set<number>();
  showDeleteModal: boolean = false;
  messagesToDelete: MailboxMessage[] = [];
  routeToDelete: ProxyRoute | null = null;
  deleteType: 'messages' | 'route' = 'messages';

  // Pagination State
  currentPage: number = 1;
  pageSize: number = 10;
  showErrorModal: boolean = false;
  errorMessage: string = '';
  sendingStatusMessage: string = '';
  showReauthModal: boolean = false;
  reauthUsername: string = '';
  reauthPassword: string = '';

  // Autocomplete State
  availableUsers = ['Admin Central', 'Seguridad TI', 'Auditoría Interna', 'Gerencia Operativa', 'Soporte Técnico', 'Analista de Riesgos', 'Oficial de Cumplimiento'];
  filteredUsers: string[] = [];
  showAutocomplete = false;

  // Sending Process State
  isSending = false;
  sendProgress = 0;
  showSendConfirmModal = false;
  showSecureVaultModal = false;
  vaultFilter: 'DOCS' | 'SSE' | 'RECENT' = 'DOCS';

  // Rich Text Editor Content (Hidden Model)
  editorContent = '';

  mockedSecureDocs = [
    { name: 'Certificado_Seguridad_2026.sse', type: 'SSE', size: '256KB', date: '2026-03-01', desc: 'Certificado de encriptación nivel 4', category: 'SSE' },
    { name: 'Reporte_Incidente_QA.pdf', type: 'PDF', size: '1.2MB', date: '2026-02-28', desc: 'Análisis de vulnerabilidades detectadas en entorno QA', category: 'DOCS' },
    { name: 'Configuracion_Vault_V2.sse', type: 'SSE', size: '45KB', date: '2026-03-05', desc: 'Parámetros de rotación de llaves maestras', category: 'SSE' },
    { name: 'Auditoria_Seguridad_Interna.txt', type: 'TXT', size: '12KB', date: '2026-03-04', desc: 'Notas de revisión de cumplimiento SOC2', category: 'DOCS' },
    { name: 'Manual_Usuario_SSandra.pdf', type: 'PDF', size: '3.4MB', date: '2026-01-15', desc: 'Documentación técnica completa del sistema', category: 'DOCS' },
    { name: 'KMS_Recovery_Keys.sse', type: 'SSE', size: '12KB', date: '2026-03-02', desc: 'Llaves de recuperación para emergencia KMS', category: 'SSE' }
  ];

  get filteredSecureDocs() {
    const list = this.vaultFilter === 'RECENT' ? this.history.slice(0, 3) : this.history;
    const mapped = list.map((d: any) => ({
      ...d,
      name: d.file_name,
      size: d.file_size || 'Vault',
      date: d.opened_at,
      type: d.file_name.split('.').pop()?.toUpperCase() || 'FILE'
    }));

    return mapped.filter((d: any) => {
      if (this.vaultFilter === 'SSE') return d.name.toLowerCase().endsWith('.sse');
      if (this.vaultFilter === 'DOCS') return !d.name.toLowerCase().endsWith('.sse');
      return true;
    });
  }

  setVaultFilter(filter: 'DOCS' | 'SSE' | 'RECENT') {
    this.vaultFilter = filter;
  }

  get filteredMessages(): MailboxMessage[] {
    let filtered = this.messages;

    // Filter by Direction (Inbox/Outbox)
    if (this.mailboxDirection) {
      filtered = filtered.filter(m => {
        const mDir = m.direction || 'inbox'; // Por defecto los viejos son inbox
        return mDir === this.mailboxDirection;
      });
    }

    // Status Filter
    if (this.statusFilter) {
      filtered = filtered.filter(m => m.status === this.statusFilter);
    }

    // Text Filter
    if (this.searchText) {
      const lower = this.searchText.toLowerCase();
      filtered = filtered.filter(m =>
        (m.sid && m.sid.toLowerCase().includes(lower)) ||
        (m.author && m.author.toLowerCase().includes(lower)) ||
        (m.responsible && m.responsible.toLowerCase().includes(lower)) ||
        (m.content && m.content.toLowerCase().includes(lower))
      );
    }

    return filtered;
  }

  get paginatedMessages(): MailboxMessage[] {
    const startIndex = (this.currentPage - 1) * this.pageSize;
    return this.filteredMessages.slice(startIndex, startIndex + this.pageSize);
  }

  get totalPages(): number {
    return Math.ceil(this.filteredMessages.length / this.pageSize) || 1;
  }

  get itemRange(): string {
    if (this.filteredMessages.length === 0) return '0 de 0';
    const start = (this.currentPage - 1) * this.pageSize + 1;
    const end = Math.min(this.currentPage * this.pageSize, this.filteredMessages.length);
    return `${start}-${end} de ${this.filteredMessages.length}`;
  }

  get isAllSelected(): boolean {
    return this.filteredMessages.length > 0 && this.selectedIds.size === this.filteredMessages.length;
  }

  get isAnySelected(): boolean {
    return this.selectedIds.size > 0;
  }

  newMessage = {
    selectedRecipients: [] as string[],
    recipientInput: '',
    sid: '',
    content: '',
    attachments: [] as any[]
  };

  onEditorChange() {
    this.saveDraft();
  }

  getMessageSnippet(content: string): string {
    if (!content) return '';
    try {
      const parsed = JSON.parse(content);
      let htmlBody = '';

      if (parsed?.message_envelope?.body) {
        htmlBody = parsed.message_envelope.body;
      } else if (parsed?.payload?.body_content) {
        htmlBody = parsed.payload.body_content;
      } else if (parsed?.payload?.body_html) {
        htmlBody = parsed.payload.body_html;
      }

      if (htmlBody) {
        // Simple regex to strip HTML tags for preview
        const stripped = htmlBody.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
        return stripped || 'Contenido Seguro Adjunto';
      }
      return 'Datos Estructurados (JSON)';
    } catch {
      return content.trim();
    }
  }

  // Config Data
  config: SecurityConfig = {
    id: 0,
    password_format_regex: '',
    reporting_level: '',
    audit_level: '',
    cache_enabled: true
  };

  // Proxy Routes Data
  proxyRoutes: ProxyRoute[] = [];
  newRoute: any = {
    route_path: '',
    target_database: 'NO',
    code: '',
    description: ''
  };
  isEditing: boolean = false;

  constructor(
    private securityService: SecurityService,
    private appState: AppStateService,
    private fileService: FileService,
    private sdcService: SdcService,
    private sanitizer: DomSanitizer
  ) { }

  ngOnInit(): void {
    if (!this.checkAuth()) return;

    this.loadMessages();
    this.loadConfig();
    this.loadProxyRoutes();
    this.generateUniqueCode();
    this.loadHistory();
    this.loadDraft();
    this.extractAuthorFromJwt();
  }

  private extractAuthorFromJwt() {
    if (this.activeConnection && this.activeConnection.jwt) {
      try {
        const payloadPart = this.activeConnection.jwt.split('.')[1];
        if (payloadPart) {
          const decodedPayload = JSON.parse(atob(payloadPart));
          const userData = decodedPayload.Usuario;
          if (userData) {
            const userName = userData.name || userData.Nombre || userData.Login || 'Usuario';
            const userRole = userData.profile || userData.description || 'Autorizado';
            this.currentAuthorName = `${userName} (${userRole})`;
          }
        }
      } catch (e) {
        console.warn("No se pudo extraer autor del JWT, usando default", e);
      }
    }
  }

  private checkAuth(): boolean {
    const configStr = localStorage.getItem('sdc_ui_config');
    if (configStr) {
      try {
        const config: SdcConfig = JSON.parse(configStr);
        const storage = config.access.jwtStorage === 'sessionStorage' ? sessionStorage : localStorage;
        const token = storage.getItem(config.access.jwtVariableName);

        if (!token) {
          console.warn("Security: Acceso denegado. Token no encontrado.");
          this.appState.setActiveTab('dashboard');
          return false;
        }
      } catch (e) {
        console.error("Error validando auth en Security", e);
        this.appState.setActiveTab('dashboard');
        return false;
      }
    }
    return true;
  }

  // --- Draft Logic ---
  saveDraft() {
    const draft = {
      newMessage: this.newMessage,
      editorContent: this.editorContent
    };
    localStorage.setItem('sandra_security_draft', JSON.stringify(draft));
  }

  loadDraft() {
    const draftStr = localStorage.getItem('sandra_security_draft');
    if (draftStr) {
      try {
        const draft = JSON.parse(draftStr);
        this.newMessage = draft.newMessage;
        this.editorContent = draft.editorContent;
        if (this.newMessage.sid || this.newMessage.content || this.editorContent || this.newMessage.attachments.length > 0) {
          this.isComposing = true;
        }
      } catch (e) {
        console.warn("Failed to load draft", e);
      }
    }
  }

  clearDraft() {
    localStorage.removeItem('sandra_security_draft');
  }

  async loadHistory() {
    try {
      this.history = await invoke('get_document_history');
    } catch (e) {
      console.warn("Could not load vault history", e);
    }
  }

  setTab(tab: 'mailbox' | 'config' | 'proxy') {
    this.activeTab = tab;
  }

  async refreshAll() {
    try {
      await Promise.all([
        this.loadMessages(),
        this.loadConfig(),
        this.loadProxyRoutes(),
        this.loadHistory()
      ]);
    } catch (error) {
      console.error('Error loading security data:', error);
    }
  }

  // --- Mailbox Logic ---
  async loadMessages() {
    this.messages = await this.securityService.getMailboxMessages();
    this.resetPagination();
  }

  resetPagination() {
    this.currentPage = 1;
  }

  nextPage() {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
    }
  }

  prevPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
    }
  }

  onPageSizeChange(size: number) {
    this.pageSize = size;
    this.resetPagination();
  }

  highlightMessage(msg: MailboxMessage) {
    this.highlightedMessage = msg;
  }

  selectMessage(msg: MailboxMessage) {
    this.selectedMessage = msg;
    this.highlightedMessage = msg;
    this.isComposing = false;
    this.parsedContent = this.parseJsonContent(msg.content);
    this.showTrace = false;
  }

  backToMailbox() {
    this.selectedMessage = null;
    this.isComposing = false;
  }

  // --- Selection Logic ---
  toggleSelectAll(event: Event) {
    event.stopPropagation();
    if (this.isAllSelected) {
      this.selectedIds.clear();
    } else {
      this.filteredMessages.forEach(m => this.selectedIds.add(m.id));
    }
  }

  toggleSelection(msg: MailboxMessage, event: Event) {
    event.stopPropagation();
    if (this.selectedIds.has(msg.id)) {
      this.selectedIds.delete(msg.id);
    } else {
      this.selectedIds.add(msg.id);
    }
  }

  // --- Deletion Logic ---
  deleteMessage(msg: MailboxMessage, event: Event) {
    event.stopPropagation();
    this.deleteType = 'messages';
    this.messagesToDelete = [msg];
    this.showDeleteModal = true;
  }

  deleteSelected() {
    if (this.selectedIds.size === 0) return;
    this.deleteType = 'messages';
    this.messagesToDelete = this.messages.filter(m => this.selectedIds.has(m.id));
    this.showDeleteModal = true;
  }

  cancelDelete() {
    this.showDeleteModal = false;
    this.messagesToDelete = [];
    this.routeToDelete = null;
  }

  async confirmDelete() {
    if (this.deleteType === 'messages') {
      if (!this.messagesToDelete.length) return;
      const idsToDelete = new Set(this.messagesToDelete.map(m => m.id));
      for (const id of idsToDelete) {
        await this.securityService.deleteMailboxMessage(id);
      }
      this.messages = this.messages.filter(m => !idsToDelete.has(m.id));
      if (this.selectedMessage && idsToDelete.has(this.selectedMessage.id)) {
        this.selectedMessage = null;
      }
      if (this.highlightedMessage && idsToDelete.has(this.highlightedMessage.id)) {
        this.highlightedMessage = null;
      }
      this.selectedIds.clear();
    } else if (this.deleteType === 'route' && this.routeToDelete) {
      this.executeDeleteRoute(this.routeToDelete.id);
    }
    this.cancelDelete();
  }

  async executeDeleteRoute(id: number) {
    try {
      await this.securityService.deleteProxyRoute(id);
      await this.loadProxyRoutes();
    } catch (e) {
      console.error('Error al eliminar ruta', e);
    }
  }

  // --- Compose Logic ---
  startCompose() {
    this.isComposing = true;
    this.selectedMessage = null;
    this.newMessage = {
      selectedRecipients: [],
      recipientInput: '',
      sid: '',
      content: '',
      attachments: []
    };
    this.editorContent = '';
    this.sendProgress = 0;
    this.isSending = false;
  }

  cancelCompose() {
    this.isComposing = false;
  }

  filterUsers() {
    const val = this.newMessage.recipientInput.toLowerCase();
    if (!val) {
      this.filteredUsers = [];
      this.showAutocomplete = false;
      return;
    }
    this.filteredUsers = this.availableUsers.filter(u =>
      u.toLowerCase().includes(val) && !this.newMessage.selectedRecipients.includes(u)
    );
    this.showAutocomplete = this.filteredUsers.length > 0;
  }

  selectUser(user: string) {
    if (!this.newMessage.selectedRecipients.includes(user)) {
      this.newMessage.selectedRecipients.push(user);
    }
    this.newMessage.recipientInput = '';
    this.showAutocomplete = false;
  }

  removeRecipient(index: number) {
    this.newMessage.selectedRecipients.splice(index, 1);
  }

  // --- Send Logic ---
  requestSend() {
    if (!this.newMessage.sid || this.newMessage.selectedRecipients.length === 0) return;
    this.showSendConfirmModal = true;
  }

  cancelSend() {
    this.showSendConfirmModal = false;
  }

  async confirmSend() {
    this.showSendConfirmModal = false;
    this.isSending = true;
    this.sendProgress = 0;

    // 1. Process Pending Uploads
    const pendingAttachments = this.newMessage.attachments.filter(a => a.status === 'PENDING' || a.status === 'ERROR');
    const totalPending = pendingAttachments.length;

    if (totalPending > 0) {
      for (let i = 0; i < totalPending; i++) {
        const att = pendingAttachments[i];
        this.sendingStatusMessage = `Firmando y transfiriendo: ${att.name}...`;

        // Brief "breathing" delay before starting each file
        await new Promise(resolve => setTimeout(resolve, 600));

        const baseProgress = (i / totalPending) * 80;

        try {
          await this.performDeferredUpload(att, (fileProgress) => {
            this.sendProgress = Math.round(baseProgress + (fileProgress / totalPending) * 0.8);
          });
        } catch (e: any) {
          console.error(`Failed to upload ${att.name}`, e);
          this.isSending = false;

          const errorMsg = e.message || String(e);
          if (errorMsg.includes('403') || errorMsg.includes('token')) {
            this.errorMessage = 'Su sesión ha expirado. Por favor, re-valide sus credenciales para continuar con el envío seguro.';
            this.reauthUsername = this.activeConnection?.username || '';
            this.showReauthModal = true;
          } else {
            this.errorMessage = `Error subiendo ${att.name}. Por favor intente de nuevo.`;
            this.showErrorModal = true;
          }
          return;
        }
      }
    }

    // Phase transition delay to allow user to see 100% upload
    this.sendingStatusMessage = "Integridad de archivos verificada. Preparando despacho...";
    this.sendProgress = 85;
    await new Promise(resolve => setTimeout(resolve, 1200));

    // 2. Final Dispatch
    this.sendingStatusMessage = "Transmitiendo reporte seguro a SDC_IMailBox...";
    this.sendProgress = 95;
    await this.executeSendMessage();

    this.sendingStatusMessage = "¡Reporte enviado exitosamente!";
    this.sendProgress = 100;

    setTimeout(() => {
      this.isSending = false;
      this.clearDraft();
    }, 1000);
  }

  closeErrorModal() {
    this.showErrorModal = false;
    this.errorMessage = '';
  }

  async retryAfterAuth() {
    if (!this.reauthUsername || !this.reauthPassword) return;

    try {
      this.sendingStatusMessage = "Re-validando credenciales...";
      this.isSending = true;
      const clientId = await this.sdcService.getClientId();

      // Intentamos conectar con las nuevas credenciales
      const connToRetry = {
        ...this.activeConnection,
        username: this.reauthUsername,
        password: this.reauthPassword
      };

      await this.sdcService.connectToServer(connToRetry, clientId);

      // Si llegamos aquí, la conexión fue exitosa (el backend de Rust habrá actualizado el hash/jwt)
      this.showReauthModal = false;
      this.reauthPassword = '';

      // Re-intentamos el proceso de envío completo
      await this.confirmSend();

    } catch (e) {
      console.error("Reauth failed", e);
      this.errorMessage = "Fallo en la autenticación. Por favor verifique su contraseña.";
      this.showErrorModal = true;
      this.isSending = false;
    }
  }

  cancelReauth() {
    this.showReauthModal = false;
    this.reauthPassword = '';
    this.isSending = false;
  }

  async performDeferredUpload(att: any, progressCallback: (p: number) => void): Promise<void> {
    att.status = 'UPLOADING';

    const hashControl = `SDC-AUTO-${this.activeConnection.hash?.substring(0, 8)}`;
    const metadata = {
      hashcontrol: hashControl,
      original_name: att.name,
      name: this.currentAuthorName || 'User Session',
      timestamp: new Date().toISOString(),
      git: 'false',
      return: 'true'
    };
    att.hashControl = hashControl;

    return new Promise(async (resolve, reject) => {
      try {
        const upload$ = await this.fileService.uploadFileRust(att.path, metadata, this.activeConnection);
        upload$.subscribe({
          next: (event) => {
            att.progress = event.progress;
            progressCallback(event.progress);
            if (event.state === 'DONE') {
              att.status = 'DONE';
              const msj = event.body?.Msj || event.body?.msj || '';
              if (msj.includes('|')) {
                att.remoteCode = msj.split('|')[1];
              } else {
                att.remoteCode = msj || event.body?.code || event.body?.hash || null;
              }
              att.size = event.body?.size || 'V24-Ready';
              // Guardar en historial local como subida exitosa
              invoke('add_document_history', { 
                fileName: att.name, 
                filePath: att.path,
                fileSize: att.size,
                remoteCode: att.remoteCode || ''
              }).catch(e => console.warn("Historial local no actualizado", e));
              resolve();
            } else if (event.state === 'ERROR') {
              att.status = 'ERROR';
              reject(new Error('Upload failed'));
            }
          },
          error: (err) => {
            att.status = 'ERROR';
            reject(err);
          }
        });
      } catch (e) {
        att.status = 'ERROR';
        reject(e);
      }
    });
  }

  async executeSendMessage() {
    const processedAttachments = this.newMessage.attachments.map((att, index) => ({
      sequence: index + 1,
      name: att.name,
      extension: att.type,
      remote_code: att.remoteCode, // THE CRITICAL PART
      viewer_config: {
        type: att.type === 'PDF' || att.type === 'SSE' ? 'pdf-viewer' : 'standard',
        isProtected: att.source === 'VAULT',
        security_icon: att.source === 'VAULT' ? 'assets/icons/lock.svg' : 'assets/icons/file.svg'
      },
      transfer_info: {
        path: att.path,
        source: att.source,
        hash_control: att.hashControl || null
      }
    }));

    const dynamicMessageId = crypto.randomUUID();

    const securePackageV23 = {
      manifest: {
        version: '0.1.6-SEC',
        timestamp: new Date().toISOString(),
        guid: dynamicMessageId,
        sender: this.currentAuthorName || 'Sandra Desktop Client'
      },
      message_envelope: {
        subject: this.newMessage.sid,
        author: this.currentAuthorName,
        recipients: this.newMessage.selectedRecipients,
        body: this.editorContent,
        attachments: processedAttachments
      }
    };

    try {
      // 1. Send to Remote Sys-Mailbox Collection
      const remotePayload = {
        coleccion: "sys-mailbox",
        objeto: securePackageV23,
        donde: `{"id":"${dynamicMessageId}"}`,
        driver: "MGDBA",
        upsert: true
      };

      const remoteEndpoint = 'v1/api/ccoleccion:hash'.replace(':hash', this.activeConnection.hash || '');

      const invokeOptions = {
        ip: this.activeConnection.ip,
        port: this.activeConnection.port,
        endpoint: remoteEndpoint,
        payload: JSON.stringify(remotePayload),
        hash: this.activeConnection.hash,
        tempAuthToken: this.activeConnection.jwt
      };

      try {
        await invoke('api_post_request', invokeOptions);
        console.log("Mensaje sincronizado exitosamente con el backend.");
      } catch (remoteError) {
        console.error("Fallo al sincronizar con sys-mailbox remoto, se guardará solo local.", remoteError);
        // Opcional: mostrar un Toast "Enviado con advertencia de sincronización"
      }

      // 2. Persist locally to the Outbox
      await this.securityService.createMailboxMessage({
        sid: this.newMessage.sid,
        content: JSON.stringify(securePackageV23, null, 2),
        author: this.currentAuthorName,
        responsible: this.newMessage.selectedRecipients.join(', '),
        direction: 'outbox'
      });
      
      this.cancelCompose();
      await this.loadMessages();
    } catch (e) {
      console.error('Failed to save message locally', e);
    }
  }

  formatDoc(cmd: string, val?: string) {
    document.execCommand(cmd, false, val);
  }

  // --- Enhanced Attachment Logic ---
  async attachFromPC() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: true,
        filters: [{ name: 'Documentos', extensions: ['pdf', 'sse', 'gpg', 'csv', 'txt', 'png', 'jpg'] }]
      });

      if (selected && Array.isArray(selected)) {
        for (const path of selected) {
          await this.processFileUpload(path);
        }
      } else if (selected && typeof selected === 'string') {
        await this.processFileUpload(selected);
      }
    } catch (e) {
      console.error("Error seleccionando archivos de PC", e);
    }
  }

  attachFromSecureViewer() {
    this.showSecureVaultModal = true;
    this.loadHistory();
  }

  async processFileUpload(filePath: string) {
    const fileName = filePath.split(/[\\/]/).pop() || filePath;
    const ext = fileName.split('.').pop()?.toUpperCase() || 'FILE';
    const attachmentId = 'att-' + Math.random().toString(36).substring(7);

    const newAtt: any = {
      id: attachmentId,
      name: fileName,
      path: filePath,
      status: 'PENDING', // START AS PENDING
      progress: 0,
      remoteCode: null,
      source: 'LOCAL',
      type: ext,
      extension: ext,
      size: 'Local'
    };
    this.newMessage.attachments.push(newAtt);
    this.saveDraft();
  }

  selectSecureDoc(doc: any) {
    const ext = doc.file_name.split('.').pop()?.toLowerCase() || 'file';
    const newAtt: any = {
      name: doc.file_name,
      type: ext.toUpperCase(),
      extension: ext.toUpperCase(),
      size: doc.file_size || 'Vault',
      date: doc.opened_at || doc.date || '',
      source: 'VAULT',
      path: doc.file_path,
      status: 'DONE',
      remoteCode: doc.remote_code || null,
      icon: this.getFileIcon(ext)
    };
    this.newMessage.attachments.push(newAtt);
    this.saveDraft();
    this.closeSecureVaultModal();
  }

  closeSecureVaultModal() {
    this.showSecureVaultModal = false;
  }

  previewSecureAttachment(att: any) {
    this.openAttachment(att);
  }

  async attachDocument() {
    await this.attachFromPC();
  }

  parseJsonContent(content: string): any {
    try {
      const cleaned = content.trim();
      if ((cleaned.startsWith('{') && cleaned.endsWith('}')) ||
        (cleaned.startsWith('[') && cleaned.endsWith(']'))) {
        return JSON.parse(cleaned);
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  toggleTrace() {
    this.showTrace = !this.showTrace;
  }

  isObject(val: any): boolean {
    return val !== null && typeof val === 'object';
  }

  getObjectKeys(obj: any): string[] {
    return Object.keys(obj);
  }

  async updateMessageStatus(msg: MailboxMessage, status: string) {
    try {
      await this.securityService.updateMailboxStatus(msg.id, status, msg.tracking_info);
      await this.loadMessages();
      if (this.selectedMessage && this.selectedMessage.id === msg.id) {
        this.selectedMessage.status = status as any;
      }
    } catch (e) {
      console.error('Failed to update status', e);
    }
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'Approved': return 'status-approved';
      case 'Rejected': return 'status-rejected';
      case 'Read': return 'status-read';
      default: return 'status-pending';
    }
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'Approved': return 'fas fa-check-circle';
      case 'Rejected': return 'fas fa-times-circle';
      case 'Read': return 'fas fa-envelope-open';
      default: return 'fas fa-clock';
    }
  }

  getFileIcon(ext: string): string {
    const lowExt = ext.toLowerCase();
    switch (lowExt) {
      case 'pdf': return 'fas fa-file-pdf';
      case 'sse': return 'fas fa-shield-alt';
      case 'zip':
      case 'rar':
      case '7z': return 'fas fa-file-archive';
      case 'txt': return 'fas fa-file-alt';
      case 'doc':
      case 'docx': return 'fas fa-file-word';
      case 'xls':
      case 'xlsx':
      case 'csv': return 'fas fa-file-excel';
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif': return 'fas fa-file-image';
      default: return 'fas fa-file';
    }
  }

  translateStatus(status: string): string {
    switch (status) {
      case 'Approved': return 'Aprobado';
      case 'Rejected': return 'Rechazado';
      case 'Read': return 'Leído';
      case 'Pending': return 'Pendiente';
      default: return status;
    }
  }

  async openAttachment(att: any) {
    const ext = (att.extension || att.type || '').toUpperCase();
    const path = att.transfer_info?.path || att.path;

    const isImage = ['PNG', 'JPG', 'JPEG', 'GIF'].includes(ext);
    const isPDF = ext === 'PDF';
    const isSSE = ext === 'SSE';
    let mimeType = '';
    if (isPDF || isSSE) mimeType = 'application/pdf';
    else if (ext === 'PNG') mimeType = 'image/png';
    else if (['JPG', 'JPEG'].includes(ext)) mimeType = 'image/jpeg';
    else if (ext === 'GIF') mimeType = 'image/gif';
    else if (ext === 'CSV') mimeType = 'text/csv';
    else if (ext === 'TXT') mimeType = 'text/plain';

    let content: any = null;

    // Use Blob strategy for local files (Pending or explicitly Local) to avoid protocol issues
    if (att.status === 'PENDING' || att.source === 'LOCAL') {
      try {
        const bytes = await readFile(path);
        const blob = new Blob([bytes], { type: mimeType });
        content = this.sanitizer.bypassSecurityTrustResourceUrl(URL.createObjectURL(blob));
      } catch (e) {
        console.error("Error reading local file for preview", e);
        // Fallback to convertFileSrc
        content = this.sanitizer.bypassSecurityTrustResourceUrl(convertFileSrc(path));
      }
    } else {
      // For vault files, convertFileSrc should work given the expanded scope
      content = this.sanitizer.bypassSecurityTrustResourceUrl(convertFileSrc(path));
    }

    if (isSSE) {
      this.appState.addTab({
        id: `secure-doc-${att.name}`,
        name: att.name,
        icon: 'assets/icons/lock.svg',
        type: 'pdf-viewer',
        isProtected: true,
        content: content,
        mimeType: mimeType,
        filePath: path
      });
    } else if (isPDF) {
      this.appState.addTab({
        id: `doc-${att.name}`,
        name: att.name,
        icon: 'assets/icons/pdf.svg',
        type: 'pdf-viewer',
        content: content,
        mimeType: mimeType,
        isProtected: false,
        filePath: path
      });
    } else if (isImage) {
      this.appState.addTab({
        id: `img-${att.name}`,
        name: att.name,
        icon: 'assets/icons/file.svg',
        type: 'file-viewer',
        content: content,
        mimeType: mimeType,
        isProtected: false,
        filePath: path
      });
    } else {
      // General Fallback
      this.appState.addTab({
        id: `file-${att.name}`,
        name: att.name,
        icon: 'assets/icons/file.svg',
        type: 'file-viewer',
        content: content,
        mimeType: mimeType,
        isProtected: false,
        filePath: path
      });
    }
  }

  async loadConfig() {
    this.config = await this.securityService.getSecurityConfig();
  }

  async saveConfig() {
    try {
      await this.securityService.updateSecurityConfig(this.config);
      alert('Configuración guardada exitosamente');
    } catch (e) {
      console.error('Error al guardar configuración', e);
    }
  }

  async loadProxyRoutes() {
    this.proxyRoutes = await this.securityService.getProxyRoutes();
  }

  async addProxyRoute() {
    if (!this.newRoute.route_path) return;
    try {
      await this.securityService.createProxyRoute(this.newRoute);
      this.resetProxyForm();
      await this.loadProxyRoutes();
    } catch (e) {
      console.error('Failed to process route', e);
    }
  }

  editProxyRoute(route: ProxyRoute) {
    this.isEditing = true;
    this.newRoute = { ...route };
  }

  cancelEdit() {
    this.resetProxyForm();
  }

  resetProxyForm() {
    this.isEditing = false;
    this.newRoute = { route_path: '', target_database: 'NO', code: '', description: '' };
    this.generateUniqueCode();
  }

  generateUniqueCode() {
    if (!this.isEditing) {
      const randomPart = Math.floor(1000 + Math.random() * 9000);
      const timestampPart = new Date().getTime().toString().slice(-4);
      this.newRoute.code = `SEC-${randomPart}-${timestampPart}`;
    }
  }

  async deleteProxyRoute(route: ProxyRoute) {
    this.deleteType = 'route';
    this.routeToDelete = route;
    this.showDeleteModal = true;
  }
}
