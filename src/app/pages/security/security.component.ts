import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  SecurityService,
  MailboxMessage,
  SecurityConfig,
  ProxyRoute
} from '../../core/services/security.service';
import { AppStateService } from '../../core/services/app-state.service';

@Component({
  selector: 'app-security',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './security.component.html',
  styleUrl: './security.component.css',
})
export class SecurityComponent implements OnInit {
  activeTab: 'mailbox' | 'config' | 'proxy' = 'mailbox';

  // Mailbox Data
  messages: MailboxMessage[] = [];
  selectedMessage: MailboxMessage | null = null;
  highlightedMessage: MailboxMessage | null = null;
  parsedContent: any = null;
  showTrace: boolean = false;
  isComposing: boolean = false;
  searchTerm: string = '';
  statusFilter: string = '';
  selectedIds: Set<number> = new Set<number>();
  showDeleteModal: boolean = false;
  messagesToDelete: MailboxMessage[] = [];
  routeToDelete: ProxyRoute | null = null;
  deleteType: 'messages' | 'route' = 'messages';

  // Pagination State
  currentPage: number = 1;
  pageSize: number = 10;

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
    if (this.vaultFilter === 'RECENT') return this.mockedSecureDocs.slice(0, 3);
    return this.mockedSecureDocs.filter(d => d.category === this.vaultFilter);
  }

  setVaultFilter(filter: 'DOCS' | 'SSE' | 'RECENT') {
    this.vaultFilter = filter;
  }

  get filteredMessages(): MailboxMessage[] {
    let result = this.messages;

    // Status Filter
    if (this.statusFilter) {
      result = result.filter(m => m.status === this.statusFilter);
    }

    // Text Filter
    if (this.searchTerm) {
      const lowerTerm = this.searchTerm.toLowerCase();
      result = result.filter(m =>
        m.sid.toLowerCase().includes(lowerTerm) ||
        m.author.toLowerCase().includes(lowerTerm) ||
        m.content.toLowerCase().includes(lowerTerm)
      );
    }

    return result;
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
    private appState: AppStateService
  ) { }

  async ngOnInit() {
    await this.refreshAll();
    this.generateUniqueCode();
  }

  setTab(tab: 'mailbox' | 'config' | 'proxy') {
    this.activeTab = tab;
  }

  async refreshAll() {
    try {
      await Promise.all([
        this.loadMessages(),
        this.loadConfig(),
        this.loadProxyRoutes()
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
    this.showTrace = false; // Reset toggle on selection
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

  // --- Elegance Deletion Modals ---
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

      // Filter out messages that are being deleted
      const idsToDelete = new Set(this.messagesToDelete.map(m => m.id));

      for (const id of idsToDelete) {
        await this.securityService.deleteMailboxMessage(id);
      }

      this.messages = this.messages.filter(m => !idsToDelete.has(m.id));

      // Cleanup state
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

  // Autocomplete Logic
  filterUsers() {
    const val = this.newMessage.recipientInput.toLowerCase();
    if (!val) {
      this.filteredUsers = [];
      this.showAutocomplete = false;
      return;
    }
    // Filter by users not already selected
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

  // --- Send Logic with Progress ---
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

    // Simulate progress
    for (let i = 0; i <= 100; i += 10) {
      this.sendProgress = i;
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    await this.executeSendMessage();
    this.isSending = false;
  }

  async executeSendMessage() {
    // PREPARING CATEGORICAL PAYLOAD (V23 Aligned with Opening Format)
    const processedAttachments = this.newMessage.attachments.map((att, index) => ({
      sequence: index + 1,
      name: att.name,
      extension: att.type,
      // Metadata used by the Viewer/System
      viewer_config: {
        type: att.type === 'PDF' || att.type === 'SSE' ? 'pdf-viewer' : 'standard',
        isProtected: att.source === 'VAULT',
        security_icon: att.source === 'VAULT' ? 'assets/icons/lock.svg' : 'assets/icons/file.svg'
      },
      transfer_info: {
        path: att.path,
        source: att.source,
        integrity_hash: `SHA256-${Math.random().toString(36).substr(2, 12)}`
      },
      // Simulated binary stream
      binary_stream: att.source === 'VAULT' ? 'AES_256_GCM_ENCRYPTED_VAULT_BLOB' : 'BASE64_LOCAL_BUFFER'
    }));

    // Unified JSON Delivery V23
    const securePackageV23 = {
      manifest: {
        version: '0.1.5-SEC',
        timestamp: new Date().toISOString(),
        guid: crypto.randomUUID(),
        sender: 'Sandra Desktop Client V1.0'
      },
      message_envelope: {
        subject: this.newMessage.sid,
        recipients: this.newMessage.selectedRecipients,
        body: this.editorContent,
        attachments: processedAttachments
      }
    };

    console.log('Sending Unified Package:', securePackageV23);

    try {
      await this.securityService.createMailboxMessage({
        sid: this.newMessage.sid,
        content: JSON.stringify(securePackageV23, null, 2),
        author: 'E. Admin (Sandra)',
        responsible: this.newMessage.selectedRecipients.join(', ')
      });
      this.cancelCompose();
      await this.loadMessages();
    } catch (e) {
      console.error('Failed to send message', e);
    }
  }

  // Rich Text Toolbar Commands
  formatDoc(cmd: string, val?: string) {
    document.execCommand(cmd, false, val);
  }

  // Enhanced Attachment Logic
  triggerFileSelect() {
    const fileInput = document.getElementById('pc-file-input');
    if (fileInput) fileInput.click();
  }

  onFileSelected(event: any) {
    const files = event.target.files;
    if (files) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext = file.name.split('.').pop()?.toLowerCase() || 'file';
        this.newMessage.attachments.push({
          name: file.name,
          type: ext.toUpperCase(),
          source: 'LOCAL',
          path: 'upload://temp/',
          icon: this.getFileIcon(ext)
        });
      }
    }
  }

  attachFromPC() {
    this.triggerFileSelect();
  }

  attachFromSecureViewer() {
    this.showSecureVaultModal = true;
  }

  closeSecureVaultModal() {
    this.showSecureVaultModal = false;
  }

  selectSecureDoc(doc: any) {
    const ext = doc.name.split('.').pop()?.toLowerCase() || 'file';
    this.newMessage.attachments.push({
      name: doc.name,
      type: ext.toUpperCase(),
      size: doc.size, // Preserve size for UI detail
      date: doc.date,
      source: 'VAULT',
      path: `secure://vault/docs/${doc.name}`,
      icon: this.getFileIcon(ext)
    });
    this.closeSecureVaultModal();
  }

  previewSecureAttachment(att: any) {
    this.openAttachment(att);
  }

  async attachDocument() {
    this.attachFromPC();
  }

  parseJsonContent(content: string): any {
    try {
      // Clean content if it has extra characters around JSON
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
      // Update selected message reference if needed
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

  openAttachment(att: any) {
    const ext = att.extension || att.type;
    const path = att.transfer_info?.path || att.path;

    if (ext === 'SSE') {
      // Open in Secure Viewer Tab
      this.appState.addTab({
        id: `secure-doc-${att.name}`,
        name: att.name,
        icon: 'assets/icons/lock.svg',
        type: 'pdf-viewer', // Use pdf-viewer type which SecureViewer component handles
        isProtected: true,
        filePath: path // Virtual path/ID for backend retrieval
      });
    } else {
      // PDF Standard
      this.appState.addTab({
        id: `doc-${att.name}`,
        name: att.name,
        icon: 'assets/icons/pdf.svg',
        type: 'pdf-viewer',
        isProtected: false,
        filePath: path
      });
    }
  }

  // --- Config Logic ---
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

  // --- Proxy Logic ---
  async loadProxyRoutes() {
    this.proxyRoutes = await this.securityService.getProxyRoutes();
  }

  async addProxyRoute() {
    if (!this.newRoute.route_path) return;
    try {
      if (this.isEditing) {
        // En un escenario real aquí llamaríamos a updateProxyRoute
        // Por ahora simulamos la creación/actualización mediante el servicio actual
        await this.securityService.createProxyRoute(this.newRoute);
      } else {
        await this.securityService.createProxyRoute(this.newRoute);
      }
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
