import { Component, OnInit, OnChanges, SimpleChanges, Input } from '@angular/core';
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
import { DataStreamService } from '../../core/services/data-stream.service';
import { readFile } from '@tauri-apps/plugin-fs';
import { listen } from '@tauri-apps/api/event';

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
export class SecurityComponent implements OnInit, OnChanges {
  @Input() activeConnection: any;

  activeTab: 'mailbox' | 'config' | 'proxy' | 'contacts' = 'mailbox';
  currentMailbox: 'Red' | 'Entrada' | 'Salida' | 'Config' | 'Boveda' = 'Entrada';
  history: any[] = [];

  // Mailbox Data
  messages: MailboxMessage[] = [];
  selectedMessage: MailboxMessage | null = null;
  highlightedMessage: MailboxMessage | null = null;
  parsedContent: any = null;
  mailboxDirection: 'inbox' | 'outbox' | 'notifications' = 'inbox'; // Novedad: Bandeja de entrada, salida o notificaciones

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

  // Autor Detallado
  authorProfile: any = {
    nombre: 'Usuario',
    usuario: 'xterm',
    correo: '',
    cargo: 'Autorizado'
  };
  systemMac: string = '';
  isSyncing: boolean = false; // Flag para el spinner de sincronización
  certificationMap: Map<string, any> = new Map(); // Store certification info for attachments (by path)

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
  filteredUsers: any[] = [];
  showAutocomplete = false;

  // Sending Process State
  isSending = false;
  sendProgress = 0;
  showSendConfirmModal = false;
  showSecureVaultModal = false;
  vaultFilter: 'DOCS' | 'SSE' | 'RECENT' = 'DOCS';
  viewerActiveTab: 'global' | 'mailbox' = 'global';
  viewerSearchText: string = '';
  showCertificationModal = false;
  selectedCertification: any = null;

  // Rich Text Editor Content (Hidden Model)
  editorContent = '';
  editorInitialContent = ''; // Separate variable for initial load to avoid cursor jump binding loop

  get filteredSecureDocs() {
    let list = this.history;

    // Filtro por Tab Principal (Global vs Mailbox)
    if (this.viewerActiveTab === 'global') {
      list = list.filter((d: any) => !d.source || d.source === 'GLOBAL');
      // Subfiltro original para Global
      if (this.vaultFilter === 'SSE') list = list.filter((d: any) => d.file_name.toLowerCase().endsWith('.sse'));
      if (this.vaultFilter === 'DOCS') list = list.filter((d: any) => !d.file_name.toLowerCase().endsWith('.sse'));
    } else {
      list = list.filter((d: any) => d.source === 'MAILBOX');
    }

    // Filtro de Texto (Buscador del Visor)
    if (this.viewerSearchText) {
      const lower = this.viewerSearchText.toLowerCase();
      list = list.filter((d: any) =>
        d.file_name.toLowerCase().includes(lower) ||
        (d.remote_code && d.remote_code.toLowerCase().includes(lower))
      );
    }

    const mapped = list.map((d: any) => ({
      ...d,
      name: d.file_name,
      size: d.file_size || 'Vault',
      date: d.opened_at,
      type: d.file_name.split('.').pop()?.toUpperCase() || 'FILE'
    }));

    return mapped;
  }

  setVaultFilter(filter: 'DOCS' | 'SSE' | 'RECENT') {
    this.vaultFilter = filter;
  }

  get filteredMessages(): MailboxMessage[] {
    let filtered = this.messages;

    // Filter by Direction (Inbox/Outbox/Notifications)
    if (this.mailboxDirection) {
      filtered = filtered.filter(m => {
        const mDir = m.direction || 'inbox';
        const isNotification = (m.author || '').includes('HSF Ticket Seguro') || (m.author || '') === 'Ejecución de Función';

        if (this.mailboxDirection === 'notifications') {
          return isNotification;
        } else if (this.mailboxDirection === 'inbox') {
          return mDir === 'inbox' && !isNotification;
        } else {
          // Outbox
          return mDir === 'outbox';
        }
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

  onEditorInput(html: string) {
    this.editorContent = html;
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

  getAttachmentCount(content: string): number {
    if (!content) return 0;
    try {
      const parsed = JSON.parse(content);
      const atts = parsed?.message_envelope?.attachments || parsed?.payload?.attachments || [];
      return Array.isArray(atts) ? atts.length : 0;
    } catch {
      return 0;
    }
  }

  getMessageGuid(content: string): string {
    if (!content) return '';
    try {
      const parsed = JSON.parse(content);
      return parsed?.manifest?.guid || parsed?.id || '';
    } catch {
      return '';
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

  // --- Contacts State ---
  contacts: any[] = [];
  contactSearchText: string = '';
  contactAppFilter: string = '';
  contactAreaFilter: string = '';
  contactView: 'grid' | 'table' = 'grid';
  contactPage: number = 1;
  contactPageSize: number = 12;
  isContactsSyncing: boolean = false;
  contactSyncMessage: string = '';

  /** Storage key scoped to the active connection's hash */
  private get contactStorageKey(): string {
    const hash = this.activeConnection?.hash || 'offline';
    return `sdc_contacts_${hash}`;
  }

  /** Label of the active connection shown in the tab */
  get activeConnectionLabel(): string {
    if (!this.activeConnection) return '';
    return `${this.activeConnection.ip_address}:${this.activeConnection.port}`;
  }

  // Contact Form
  showContactForm: boolean = false;
  editingContactId: number | null = null;
  contactForm: any = this.emptyContactForm();

  // Contact Delete
  showDeleteContactModal: boolean = false;
  contactToDelete: any = null;

  get contactApplications(): string[] {
    return [...new Set(this.contacts.map(c => c.sistema || c.aplicacion).filter(Boolean))].sort();
  }

  get contactAreas(): string[] {
    return [...new Set(this.contacts.map(c => c.Perfil?.descripcion || c.perfil_grupo).filter(Boolean))].sort();
  }

  get filteredContacts(): any[] {
    let list = this.contacts;
    if (this.contactSearchText) {
      const q = this.contactSearchText.toLowerCase();
      list = list.filter(c =>
        (c.login || '').toLowerCase().includes(q) ||
        (c.nombre || '').toLowerCase().includes(q) ||
        (c.cargo || '').toLowerCase().includes(q) ||
        (c.correo || '').toLowerCase().includes(q) ||
        (c.descripcion || '').toLowerCase().includes(q) ||
        (c.Perfil?.descripcion || '').toLowerCase().includes(q) ||
        (c.perfil_grupo || '').toLowerCase().includes(q) ||
        (c.sistema || '').toLowerCase().includes(q) ||
        (c.aplicacion || '').toLowerCase().includes(q)
      );
    }
    if (this.contactAppFilter) {
      list = list.filter(c => (c.sistema || c.aplicacion) === this.contactAppFilter);
    }
    if (this.contactAreaFilter) {
      list = list.filter(c => (c.Perfil?.descripcion || c.perfil_grupo) === this.contactAreaFilter);
    }
    return list;
  }

  get paginatedContacts(): any[] {
    const start = (this.contactPage - 1) * this.contactPageSize;
    return this.filteredContacts.slice(start, start + this.contactPageSize);
  }

  get totalContactPages(): number {
    return Math.ceil(this.filteredContacts.length / this.contactPageSize) || 1;
  }

  private emptyContactForm() {
    return { login: '', nombre: '', correo: '', descripcion: '', cargo: '', perfil_grupo: '', aplicacion: '', Perfil: { descripcion: '' } };
  }

  constructor(
    private securityService: SecurityService,
    private appState: AppStateService,
    private fileService: FileService,
    private sdcService: SdcService,
    private dataStreamService: DataStreamService,
    private sanitizer: DomSanitizer
  ) { }

  ngOnInit(): void {
    if (!this.checkAuth()) return;

    this.loadMessages();
    this.loadConfig();
    this.loadProxyRoutes();
    this.generateUniqueCode();
    this.loadHistory();
    this.extractAuthorFromJwt();
    this.loadSystemIdentity();
    this.loadContactsLocal(); // load contacts for current connection on init

    // Listener para refrescar el buzón cuando Rust termine una sincronización
    listen('refresh-mailbox', () => {
      this.loadMessages();
    });

    // Sincronización inicial al entrar
    this.syncMailbox();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // When the active connection changes, reload contacts scoped to the new connection
    if (changes['activeConnection'] && !changes['activeConnection'].firstChange) {
      this.contacts = [];
      this.contactSearchText = '';
      this.contactAppFilter = '';
      this.contactAreaFilter = '';
      this.contactPage = 1;
      this.loadContactsLocal();
      // Re-sync if we're on the contacts tab
      if (this.activeTab === 'contacts' && this.activeConnection?.hash) {
        this.syncContacts();
      }
    }
  }

  private async loadSystemIdentity() {
    try {
      const stats = await this.sdcService.getSystemTelemetry();
      this.systemMac = stats.mac_address || '00:00:00:00:00:00';
    } catch (e) {
      console.warn("No se pudo obtener MAC para el sello", e);
    }
  }

  private extractAuthorFromJwt() {
    if (this.activeConnection && this.activeConnection.jwt) {
      try {
        const payloadPart = this.activeConnection.jwt.split('.')[1];
        if (payloadPart) {
          const decodedPayload = JSON.parse(atob(payloadPart));
          const userData = decodedPayload.Usuario;
          if (userData) {
            this.authorProfile = {
              nombre: userData.nombre || userData.name || userData.Nombre || 'Usuario',
              usuario: userData.usuario || userData.Login || 'persona',
              correo: userData.correo || userData.email || '',
              cargo: userData.cargo || userData.descripcion || (userData.Perfil ? userData.Perfil.descripcion : 'Autorizado')
            };
            this.currentAuthorName = `${this.authorProfile.nombre} (${this.authorProfile.cargo})`;
          }
        }
      } catch (e) {
        console.warn("No se pudo extraer autor del JWT, usando default", e);
      }
    }
  }

  private checkAuth(): boolean {
    const configStr = localStorage.getItem('sdc_ui_config');
    const isRealJwt = (t: any) => t && t.length > 20 && t.includes('.');

    if (configStr) {
      try {
        const config: SdcConfig = JSON.parse(configStr);
        const storage = config.access.jwtStorage === 'sessionStorage' ? sessionStorage : localStorage;
        const token = storage.getItem(config.access.jwtVariableName);

        if (!isRealJwt(token)) {
          console.warn("Security: Acceso denegado. Token no válido.");
          this.appState.setActiveTab('dashboard');
          return false;
        }
      } catch (e) {
        console.error("Error validando auth en Security", e);
        this.appState.setActiveTab('dashboard');
        return false;
      }
    } else {
      // Si no hay configuración guardada, por seguridad bloqueamos
      console.warn("Security: Configuración no encontrada.");
      this.appState.setActiveTab('dashboard');
      return false;
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
        this.editorInitialContent = draft.editorContent; // Load initial content once to avoid binding loop jump
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
      // Trigger lazy verification for history items
      this.history.forEach(doc => {
        if (doc.file_path) this.verifyAttachmentCertification(doc.file_path);
      });
    } catch (e) {
      console.warn("Could not load vault history", e);
    }
  }

  setTab(tab: 'mailbox' | 'config' | 'proxy' | 'contacts') {
    this.activeTab = tab;
    if (tab === 'contacts' && this.contacts.length === 0) {
      this.syncContacts();
    }
  }

  async refreshAll() {
    try {
      this.isSyncing = true;
      await this.securityService.syncMailbox();
      await Promise.all([
        this.loadMessages(),
        this.loadConfig(),
        this.loadProxyRoutes(),
        this.loadHistory()
      ]);
    } catch (error) {
      console.error('Error loading security data:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  async syncMailbox() {
    if (this.isSyncing) return;
    this.isSyncing = true;
    try {
      // El comando Rust ahora se encarga de todo: Manifiesto (Streaming), Descarga y ACK (Streaming)
      const guids = await this.securityService.syncMailbox();
      if (guids && guids.length > 0) {
        console.log(`Sincronización completa (incluyendo ACKs) para ${guids.length} ítems.`);
      }
    } catch (e) {
      console.error("Error sincronizando buzón:", e);
    } finally {
      this.isSyncing = false;
      this.loadMessages();
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
    this.editorInitialContent = ''; // Clear initial content
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

    // Filter from local contacts
    const matchingContacts = this.contacts.filter(c => {
      const match =
        (c.login || '').toLowerCase().includes(val) ||
        (c.nombre || '').toLowerCase().includes(val) ||
        (c.correo || '').toLowerCase().includes(val) ||
        (c.cargo || '').toLowerCase().includes(val) ||
        (c.descripcion || '').toLowerCase().includes(val) ||
        (c.Perfil?.descripcion || '').toLowerCase().includes(val) ||
        (c.perfil_grupo || '').toLowerCase().includes(val) ||
        (c.aplicacion || '').toLowerCase().includes(val);

      const notSelected =
        !this.newMessage.selectedRecipients.includes(c.login || '') &&
        !this.newMessage.selectedRecipients.includes(c.correo || '') &&
        !this.newMessage.selectedRecipients.includes(c.nombre || '');

      return match && notSelected;
    });

    const groups: { [key: string]: any[] } = {};
    matchingContacts.forEach(c => {
      const gName = c.Perfil?.descripcion || c.perfil_grupo || 'Sin Perfil';
      if (!groups[gName]) groups[gName] = [];
      groups[gName].push(c);
    });

    const profiles: any[] = [];
    const individuals: any[] = [];

    // Main Sections Headers
    const result: any[] = [];

    // 1. Collect Profiles/Groups
    Object.keys(groups).sort().forEach(groupName => {
      profiles.push({
        isHeader: true,
        name: groupName,
        isGroup: true,
        detail: `Enviar campaña a todo el perfil (${groups[groupName].length} contactos)`
      });
    });

    // 2. Collect Individual Users
    matchingContacts.sort((a, b) => (a.nombre || a.login).localeCompare(b.nombre || b.login)).forEach(c => {
      individuals.push({
        isHeader: false,
        name: c.nombre || c.login,
        profile: c.Perfil?.descripcion || c.perfil_grupo || 'Sin Perfil',
        detail: `${c.login.trim().toLowerCase() + '@' + c.sistema.trim().toLowerCase() || ''}`,
        initials: this.getContactInitials(c.nombre || c.login || c.correo),
        isContact: true
      });
    });

    // Assemble final result with main separators (Individuals FIRST, then Profiles)
    if (individuals.length > 0) {
      result.push({ isMainSeparator: true, name: 'Contactos Individuales' });
      result.push(...individuals);
    }
    if (profiles.length > 0) {
      result.push({ isMainSeparator: true, name: 'Campaña por Perfiles (Campaña)' });
      result.push(...profiles);
    }

    this.filteredUsers = result;
    this.showAutocomplete = this.filteredUsers.length > 0;
  }

  selectUser(userObj: any) {
    if (!userObj || userObj.isMainSeparator) return;
    const label = userObj.isGroup ? `[PERFIL] ${userObj.name}` : userObj.detail;
    if (!this.newMessage.selectedRecipients.includes(label)) {
      this.newMessage.selectedRecipients.push(label);
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
              console.log("Upload done", event);

              // 1. Extraer remoteCode desde 'contenido' si existe (Mapeo Original|Remoto)
              if (event.body?.contenido && Array.isArray(event.body.contenido)) {
                const match = event.body.contenido.find((c: string) =>
                  c.toLowerCase().includes(att.name.toLowerCase()) ||
                  c.toLowerCase().includes(att.path.toLowerCase().split(/[\\/]/).pop() || "")
                );
                if (match && match.includes('|')) {
                  att.remoteCode = match.split('|')[1];
                }
              }

              // 2. Fallback al 'msj' si no se encontró en contenido
              if (!att.remoteCode) {
                const msj = event.body?.Msj || event.body?.msj || '';
                if (msj.includes('|')) {
                  att.remoteCode = msj.split('|')[1];
                } else {
                  att.remoteCode = msj || event.body?.code || event.body?.hash || null;
                }
              }

              att.size = event.body?.size || 'V24-Ready';
              // Guardar en historial local como subida exitosa
              invoke('add_document_history', {
                fileName: att.name,
                filePath: att.path,
                fileSize: att.size,
                remoteCode: att.remoteCode || '',
                source: 'MAILBOX'
              }).then((finalPath: any) => {
                if (finalPath) att.path = finalPath;
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
        sender: this.currentAuthorName || 'Sandra Desktop Client',
        login: `SDC-Seal(Signed by ${this.authorProfile.usuario} ${this.authorProfile.nombre} (${this.authorProfile.cargo}) (${this.systemMac}))`,
        estatus: 'Pending',
        para: this.newMessage.selectedRecipients,
        download_count: 0
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
        coleccion: "sdc-mailbox",
        objeto: securePackageV23,
        donde: `{"id":"${dynamicMessageId}"}`,
        driver: "MGDBA",
        upsert: true
      };

      const remoteEndpoint = 'v1/api/ccoleccion';

      const invokeOptions = {
        ip: this.activeConnection.ip_address,
        port: Number(this.activeConnection.port),
        endpoint: remoteEndpoint,
        payload: remotePayload, // Pasar el objeto directamente para que Rust lo reciba como Value::Object
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

  applyTemplate(type: string) {
    if (!type) return;

    let templateHtml = '';
    const now = new Date().toLocaleDateString();
    const user = this.authorProfile.nombre || 'Personal Autorizado';
    const cargo = this.authorProfile.cargo || 'Funcionario';

    switch (type) {
      case 'MEMO':
        templateHtml = `
          <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <p style="text-align: center; font-weight: bold; font-size: 1.2rem; text-decoration: underline; margin-bottom: 25px;">MEMORÁNDUM Nro: SND-2024-${Math.floor(Math.random() * 1000)}</p>
            <p><strong>PARA:</strong> Destinatario Principal</p>
            <p><strong>DE:</strong> ${user} (${cargo})</p>
            <p><strong>FECHA:</strong> ${now}</p>
            <p><strong>ASUNTO:</strong> Notificación de Seguridad Operativa</p>
            <hr style="border: 0; border-top: 1px solid #cbd5e1; margin: 20px 0;">
            <p>Por medio de la presente, se informa que...</p>
            <br><br>
            <p>Atentamente,</p>
            <p><strong>${user}</strong></p>
          </div>
        `;
        break;
      case 'RADIOGRAMA':
        templateHtml = `
          <div style="font-family: 'Courier New', monospace; padding: 20px; background-color: #f8fafc; border: 2px solid #64748b;">
            <p><strong>PRIORIDAD:</strong> MÁXIMA / CIFRADO</p>
            <p><strong>ORIGEN:</strong> Sandra Core Terminal V24</p>
            <p><strong>FECHA/HORA:</strong> ${new Date().toLocaleString()}</p>
            <p><strong>TEXTO:</strong></p>
            <p style="padding: 15px; border-left: 4px solid #1e293b;">SOLICITO VERIFICACIÓN DE CREDENCIALES EN EL NODO...</p>
          </div>
        `;
        break;
      case 'COMUNICADO':
        templateHtml = `
          <div style="font-family: Inter, sans-serif; text-align: center; padding: 30px; border: 4px double #66BB6A;">
            <h1 style="color: #66BB6A; margin-bottom: 5px;">COMUNICADO OFICIAL</h1>
            <p style="font-style: italic; color: #64748b;">División de Seguridad Sandra</p>
            <br>
            <p style="text-align: justify; line-height: 1.6;">Se hace de conocimiento general que las políticas de acceso han sido actualizadas conforme al protocolo...</p>
          </div>
        `;
        break;
      case 'REUNION':
        templateHtml = `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2 style="border-bottom: 2px solid #66BB6A; padding-bottom: 10px;">MINUTA DE REUNIÓN - ${now}</h2>
            <p><strong>ASISTENTES:</strong> ${user}, ...</p>
            <p><strong>OBJETIVO:</strong> Seguimiento de Incidencias Criticas</p>
            <h3>1. TEMAS TRATADOS</h3>
            <ul><li>Punto A...</li><li>Punto B...</li></ul>
            <h3>2. ACUERDOS</h3>
            <p>Se acuerda implementar...</p>
          </div>
        `;
        break;
      case 'CAMPAÑA':
        templateHtml = `
          <div style="background: linear-gradient(to right, #f0fdf4, #ffffff); padding: 25px; border-radius: 12px; border: 1px solid #bcf0da;">
            <h2 style="color: #065f46;">PLAN DE CAMPAÑA: OPERACIÓN ESCUDO</h2>
            <p><strong>OBJETIVO:</strong> Mitigación de brechas de integridad en bases de datos.</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
              <tr style="background: #ecfdf5;">
                <th style="padding: 10px; border: 1px solid #d1fae5;">Fase</th>
                <th style="padding: 10px; border: 1px solid #d1fae5;">Acción</th>
              </tr>
              <tr>
                <td style="padding: 10px; border: 1px solid #d1fae5;">Detección</td>
                <td style="padding: 10px; border: 1px solid #d1fae5;">Escaneo de Nodos Pasivos</td>
              </tr>
            </table>
          </div>
        `;
        break;
    }

    if (templateHtml) {
      this.editorContent = templateHtml;
      this.editorInitialContent = templateHtml;
      this.saveDraft();
    }
  }

  formatDoc(cmd: string, val?: string) {
    document.execCommand(cmd, false, val);
    // Sync after format to ensure content matches and draft is saved
    const editorEle = document.querySelector('.rich-textarea') as HTMLElement;
    if (editorEle) {
      this.editorContent = editorEle.innerHTML;
      this.saveDraft();
    }
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
    this.verifyAttachmentCertification(filePath);
  }

  async verifyAttachmentCertification(path: string) {
    try {
      const result = await invoke<any>('verify_file_seal', { filePath: path });
      if (result && result.status === 'VALID') {
        this.certificationMap.set(path, result);
        console.log("Certification found for attachment:", path, result);
      } else {
        this.certificationMap.delete(path);
      }
    } catch (e) {
      console.warn("Cert verify failed for attachment", e);
      this.certificationMap.delete(path);
    }
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
      status: 'PENDING', // CAMBIADO DE 'DONE' A 'PENDING' PARA ACTIVAR CICLO DE FIRMA Y SUBIDA
      remoteCode: doc.remote_code || null,
      icon: this.getFileTypeConfig(doc.file_name).icon
    };
    this.newMessage.attachments.push(newAtt);
    this.saveDraft();
    this.verifyAttachmentCertification(doc.file_path);
    this.closeSecureVaultModal();
  }

  openCertificationDetails(att: any, event: Event) {
    event.stopPropagation();
    const cert = this.certificationMap.get(att.path);
    if (cert) {
      this.selectedCertification = cert;
      this.selectedCertification.fileName = att.name;
      this.showCertificationModal = true;
    }
  }

  closeCertificationModal() {
    this.showCertificationModal = false;
    this.selectedCertification = null;
  }

  closeSecureVaultModal() {
    this.showSecureVaultModal = false;
    this.viewerSearchText = '';
  }

  async uploadToGlobal() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Documentos', extensions: ['pdf', 'sse', 'gpg', 'csv', 'txt', 'png', 'jpg'] }]
      });

      if (selected && typeof selected === 'string') {
        const fileName = selected.split(/[\\/]/).pop() || selected;
        // Simular registro en historial como Global
        await invoke('add_document_history', {
          fileName: fileName,
          filePath: selected,
          fileSize: 'Local',
          remoteCode: '',
          source: 'GLOBAL'
        });
        await this.loadHistory();
      }
    } catch (e) {
      console.error("Error subiendo a global", e);
    }
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
      case 'Approved':
      case 'Completed': return 'status-approved';
      case 'Rejected': return 'status-rejected';
      case 'Read': return 'status-read';
      default: return 'status-pending';
    }
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'Approved':
      case 'Completed': return 'fas fa-check-circle';
      case 'Rejected': return 'fas fa-times-circle';
      case 'Read': return 'fas fa-envelope-open';
      default: return 'fas fa-clock';
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

  getFileExtension(fileName: string): string {
    return fileName.split('.').pop()?.toUpperCase() || 'FILE';
  }

  translateStatus(status: string): string {
    switch (status) {
      case 'Approved': return 'Aprobado';
      case 'Completed': return 'Completado';
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

    // Use Blob strategy for any file that is local/vault to avoid protocol issues (like unsupported URL error)
    const isLocalOrVault = att.source === 'LOCAL' || att.source === 'VAULT' ||
      (att.transfer_info && (att.transfer_info.source === 'LOCAL' || att.transfer_info.source === 'VAULT')) ||
      (path && path.includes('sandra_vault'));

    if (att.status === 'PENDING' || att.status === 'UPLOADING' || isLocalOrVault) {
      try {
        const bytes = await readFile(path);
        const blob = new Blob([bytes], { type: mimeType });
        content = this.sanitizer.bypassSecurityTrustResourceUrl(URL.createObjectURL(blob));
      } catch (e) {
        console.error("Error reading file for preview via Blob strategy", e);
        // Fallback to convertFileSrc
        content = this.sanitizer.bypassSecurityTrustResourceUrl(convertFileSrc(path));
      }
    } else {
      // For remote or other files
      content = this.sanitizer.bypassSecurityTrustResourceUrl(convertFileSrc(path));
    }

    if (path) {
      this.verifyAttachmentCertification(path);
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

  // =====================
  // CONTACTS MODULE
  // =====================

  loadContactsLocal() {
    try {
      const stored = localStorage.getItem(this.contactStorageKey);
      if (stored) this.contacts = JSON.parse(stored);
      else this.contacts = [];
    } catch { this.contacts = []; }
  }

  saveContactsLocal() {
    localStorage.setItem(this.contactStorageKey, JSON.stringify(this.contacts));
  }

  async syncContacts() {
    if (this.isContactsSyncing) return;
    this.isContactsSyncing = true;

    // First load local
    this.loadContactsLocal();

    if (!this.activeConnection?.hash) {
      this.isContactsSyncing = false;
      return;
    }

    try {
      const endpoint = `v1/api/crud:${this.activeConnection.hash}`;
      const payload = {
        "funcion": 'SDC_CUsers',
        "parametros": this.contactAppFilter || ''
      };

      const response: any = await invoke('api_post_request', {
        ip: this.activeConnection.ip_address,
        port: Number(this.activeConnection.port),
        endpoint,
        payload,
        hash: this.activeConnection.hash,
        tempAuthToken: this.activeConnection.jwt
      });

      if (response && Array.isArray(response)) {
        // Merge remote data with local, remote takes precedence by login
        const remoteLogins = new Set(response.map((c: any) => (c.login || c.user_name || '').toLowerCase()));
        const localOnly = this.contacts.filter(c => !remoteLogins.has((c.login || '').toLowerCase()));
        this.contacts = [...response, ...localOnly];
        this.saveContactsLocal();
      } else if (response && response.data && Array.isArray(response.data)) {
        this.contacts = response.data;
        this.saveContactsLocal();
      } else if (response && response.msj === 'Ok' && response.contenido) {
        this.contacts = Array.isArray(response.contenido) ? response.contenido : [];
        this.saveContactsLocal();
      }
    } catch (e) {
      console.warn('Contacts sync error (using local data):', e);
    } finally {
      this.isContactsSyncing = false;
    }
  }

  resetContactPagination() {
    this.contactPage = 1;
  }

  openContactForm() {
    this.editingContactId = null;
    this.contactForm = this.emptyContactForm();
    this.showContactForm = true;
  }

  editContact(contact: any) {
    this.editingContactId = contact.id || null;
    this.contactForm = { ...contact };
    this.showContactForm = true;
  }

  closeContactForm() {
    this.showContactForm = false;
    this.editingContactId = null;
    this.contactForm = this.emptyContactForm();
  }

  saveContact() {
    if (!this.contactForm.login) return;

    // Normalize and search for existing by login
    const targetLogin = (this.contactForm.login || '').trim().toLowerCase();
    const existingIdx = this.contacts.findIndex(c =>
      (c.login || '').trim().toLowerCase() === targetLogin
    );

    if (this.editingContactId) {
      // Direct edit mode
      const idx = this.contacts.findIndex(c => c.id === this.editingContactId);
      if (idx !== -1) {
        this.contacts[idx] = { ...this.contactForm, id: this.editingContactId };
      }
    } else if (existingIdx !== -1) {
      // Sync/Update mode: Duplicate login detected, merge attributes
      this.contacts[existingIdx] = {
        ...this.contacts[existingIdx],
        ...this.contactForm
      };
    } else {
      // New record mode
      const newContact = {
        ...this.contactForm,
        id: Date.now()
      };
      this.contacts.unshift(newContact);
    }

    this.saveContactsLocal();
    this.closeContactForm();
  }

  confirmDeleteContact(contact: any) {
    this.contactToDelete = contact;
    this.showDeleteContactModal = true;
  }

  executeDeleteContact() {
    if (!this.contactToDelete) return;
    this.contacts = this.contacts.filter(c => c.id !== this.contactToDelete.id);
    this.saveContactsLocal();
    this.showDeleteContactModal = false;
    this.contactToDelete = null;
  }

  getContactInitials(name: string): string {
    if (!name) return '?';
    const parts = name.trim().split(/[\s._-]+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  }

  sendEmailToContact(contact: any) {
    if (!contact?.login || !contact?.sistema) return;

    // Format target email
    const email = `${contact.login.trim().toLowerCase()}@${contact.sistema.trim().toLowerCase()}`;
    
    // Switch to mailbox tab
    this.activeTab = 'mailbox';
    
    // Only reset/start new if we weren't already composing
    if (!this.isComposing) {
      this.startCompose();
    }

    // Add to list if not already present
    if (email && !this.newMessage.selectedRecipients.includes(email)) {
      this.newMessage.selectedRecipients.push(email);
    }
  }
}
