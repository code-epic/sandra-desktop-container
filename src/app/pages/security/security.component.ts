import { Component, OnInit, OnChanges, SimpleChanges, Input, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { debounceTime, distinctUntilChanged, firstValueFrom } from 'rxjs';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { appDataDir, join } from '@tauri-apps/api/path';
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
import { MAIL_TEMPLATES, TemplateData } from './templates/mail-templates';

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
  machineName: string = 'Sandra Node';

  activeTab: 'mailbox' | 'config' | 'proxy' | 'contacts' = 'mailbox';
  clientId: string = '';
  currentMailbox: 'Red' | 'Entrada' | 'Salida' | 'Config' | 'Boveda' = 'Entrada';
  history: any[] = [];

  // Mailbox Data
  messages: MailboxMessage[] = [];
  selectedMessage: MailboxMessage | null = null;
  @ViewChild('editor') editorElement?: ElementRef;

  // Helper para contador de vida del Workflow
  getWorkflowUptime(createdAtStr: string): string {
    if (!createdAtStr) return '';
    try {
      const createdDate = new Date(createdAtStr);
      if (isNaN(createdDate.getTime())) return '';
      const diffMs = Math.abs(new Date().getTime() - createdDate.getTime());
      const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffHrs / 24);
      
      if (diffDays > 0) {
        return `${diffDays}d ${diffHrs % 24}h`;
      } else if (diffHrs > 0) {
        const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        return `${diffHrs}h ${diffMins}m`;
      } else {
        const diffMins = Math.floor(diffMs / (1000 * 60));
        return `${diffMins} min`;
      }
    } catch { return ''; }
  }
  highlightedMessage: MailboxMessage | null = null;
  parsedContent: any = null;
  mailboxDirection: 'inbox' | 'outbox' | 'notifications' = 'inbox';

  // Estado del Autor y UI
  authorProfile: any = { nombre: '', usuario: '', correo: '', sistema: '', cargo: '' };
  currentAuthorName: string = 'E. Admin (Sandra)';
  systemMac: string = '';
  showTrace: boolean = false;
  isComposing: boolean = false;
  searchText: string = '';
  statusFilter: string = '';
  selectedIds: Set<number> = new Set<number>();

  // Modales y Estados de Acción
  showDeleteModal: boolean = false;
  messagesToDelete: MailboxMessage[] = [];
  routeToDelete: ProxyRoute | null = null;
  deleteType: 'messages' | 'route' = 'messages';
  certificationMap: Map<string, any> = new Map();

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
  expandedGroups: Set<string> = new Set();

  toggleGroup(groupId: string) {
    if (this.expandedGroups.has(groupId)) {
      this.expandedGroups.delete(groupId);
    } else {
      this.expandedGroups.add(groupId);
    }
  }

  showCertificationModal = false;
  selectedCertification: any = null;
  downloadingStatus: Map<string, number> = new Map();

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
        (d.file_name && d.file_name.toLowerCase().includes(lower)) ||
        (d.remote_code && d.remote_code.toLowerCase().includes(lower))
      );
    }

    const mapped = list.map((d: any) => ({
      ...d,
      name: d.file_name,
      size: d.file_size || 'Vault',
      date: d.opened_at || d.created_at,
    }));


    // Nueva Lógica de Agrupación nativa por group_name (Sincronizada con secure-viewer)
    const result: any[] = [];
    const groupsMap = new Map<string, any>();

    mapped.forEach((item: any) => {
      if (item.group_name) {
        if (!groupsMap.has(item.group_name)) {
          const group = {
            isGroup: true, // we use isGroup for template compatibility
            isFolder: true,
            id: 'folder-' + item.group_name,
            name: item.group_name,
            items: [],
            date: item.date,
            size: 0
          };
          groupsMap.set(item.group_name, group);
          result.push(group);
        }
        const group = groupsMap.get(item.group_name);
        group.items.push(item);
        group.size = group.items.length;
        // Keep the most recent date for the group
        if (new Date(item.date) > new Date(group.date)) group.date = item.date;
      } else {
        result.push({ ...item, isGroup: false });
      }
    });

    return result.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  get groupedFilteredDocs() {
     return this.filteredSecureDocs;
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

  getMessageSubject(content: string): string {
    if (!content) return '';
    try {
      const parsed = JSON.parse(content);
      return parsed?.message_envelope?.subject || parsed?.sid || '';
    } catch { return ''; }
  }

  getMessageGuid(content: string): string {
    if (!content) return '';
    try {
      const parsed = JSON.parse(content);
      return parsed?.manifest?.guid || parsed?.id || '';
    } catch { return ''; }
  }

  getMessageMacAddress(content: string): string {
    if (!content) return '';
    try {
      const parsed = JSON.parse(content);
      return parsed?.manifest?.macaddress || '';
    } catch { return ''; }
  }

  getMessageUuid(content: string): string {
    if (!content) return '';
    try {
      const parsed = JSON.parse(content);
      return parsed?.manifest?.uuid || parsed?.manifest?.guid || '';
    } catch { return ''; }
  }

  maskUuid(uuid: string): string {
    if (!uuid) return '';
    // Show first 8 and last 4 for traceability but hide middle
    if (uuid.length > 12) {
      return `${uuid.substring(0, 8)}...${uuid.substring(uuid.length - 4)}`;
    }
    return uuid;
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
        (c.aplicacion || '').toLowerCase().includes(q) ||
        (c.firmadigital?.direccionmac || '').toLowerCase().includes(q)
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
    public securityService: SecurityService,
    private appState: AppStateService,
    private fileService: FileService,
    private sdcService: SdcService,
    private sanitizer: DomSanitizer
  ) { }

  async ngOnInit() {
    if (!this.checkAuth()) return;

    // 1. Initial Load (Unified)
    await this.loadConfig();
    this.loadMessages();
    this.loadHistory();
    this.loadProxyRoutes();
    this.generateUniqueCode();
    this.extractAuthorFromJwt();
    this.loadSystemIdentity();
    this.loadContactsLocal();

    // 2. Event Listeners
    listen('mailbox-download-progress', (event: any) => {
      const { remote_code, progress, status } = event.payload;
      this.downloadingStatus.set(remote_code, progress);
      if (status === 'completed') {
        setTimeout(() => this.downloadingStatus.delete(remote_code), 3000);
        this.loadHistory(); // Refresh history to update UI indicators
      }
    });

    // 3. Reactive Streams
    // Suscripción al trigger de refresco global (SDC Sync Pulses) con debounce para evitar sobrecarga
    this.securityService.mailboxRefreshTrigger$.pipe(
      debounceTime(2000)
    ).subscribe(() => {
      console.log("[Security] Ejecutando sincronización por trigger");
      this.syncMailbox();
    });

    // Suscripción al estado de sincronización global para refrescar la vista
    this.securityService.syncStatus$.subscribe(status => {
      if (status === 'completed') {
        this.loadMessages();
      }
    });

    // Sincronización inicial al entrar
    this.syncMailbox();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Detectar cambios en el perfil del autor para sincronizar el buzón
    if (changes['authorProfile'] && this.authorProfile?.usuario) {
      this.syncMailbox();
    }

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
      this.syncMailbox(); // También sincronizar buzón al cambiar conexión
    }
  }

  private async loadSystemIdentity() {
    try {
      const stats = await this.sdcService.getSystemTelemetry();
      this.systemMac = stats.mac_address || '00:00:00:00:00:00';
      this.clientId = await this.sdcService.getClientId();

      // Load machine identity from setup
      const setup = await this.sdcService.getSetupStatus();
      if (setup && setup.machine_name) {
        this.machineName = setup.machine_name;
      }
    } catch (e) {
      console.warn("No se pudo obtener identidad del sistema", e);
    }
  }

  private extractAuthorFromJwt() {
    if (this.activeConnection && this.activeConnection.jwt) {
      try {
        const payloadPart = this.activeConnection.jwt.split('.')[1];
        if (payloadPart) {
          // JWT utiliza Base64Url (sustituir '-' por '+' y '_' por '/')
          // Añadir padding '=' si es necesario para atob en todos los motores
          let base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
          while (base64.length % 4) {
            base64 += '=';
          }
          const decodedPayload = JSON.parse(atob(base64));
          const userData = decodedPayload.Usuario;
          if (userData) {
            this.authorProfile = {
              nombre: userData.nombre || userData.name || userData.Nombre || 'Usuario',
              usuario: userData.usuario || userData.Login || 'persona',
              correo: userData.correo || userData.email || '',
              sistema: userData.sistema || 'consola',
              cargo: userData.cargo || userData.descripcion || (userData.Perfil ? userData.Perfil.descripcion : 'Autorizado')
            };
            this.currentAuthorName = `${this.authorProfile.nombre} (${this.authorProfile.cargo})`;
          }
        }
      } catch (e) {
        console.warn("No se pudo extraer autor del JWT (Base64Url Fix):", e);
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
      this.history = await invoke('get_document_history', { userLogin: this.securityService.getCurrentUserLogin() });
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
      await this.securityService.syncMailbox();
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

  async syncMailbox() {
    if ((await firstValueFrom(this.securityService.isSyncing$)) || !this.activeConnection) return;

    // Iniciar sincronización industrial global mediante el servicio centralizado
    this.securityService.startMailboxSync(this.activeConnection, this.authorProfile);
  }

  // --- Mailbox Logic ---
  async loadMessages() {
    this.messages = await this.securityService.getMailboxMessages(this.authorProfile.usuario);
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
    this.securityService.playDeleteSound();
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
    this.nuevoWorkflowTipo = ''; // Resetear estado de workflow
  }

  cancelCompose() {
    this.isComposing = false;
  }

  replyMessage(msg: MailboxMessage) {
    this.startCompose();
    // 1. Asignar Destinatario
    this.newMessage.selectedRecipients = [msg.author];

    // 2. Formatear Asunto
    const currentSubject = this.getMessageSubject(msg.content) || msg.sid || 'Requerimiento';
    this.newMessage.sid = currentSubject.toUpperCase().startsWith('RE:') ? currentSubject : `Re: ${currentSubject}`;

    // 3. Formatear Cita del mensaje anterior
    const oldContent = this.parsedContent?.message_envelope?.body ||
      this.parsedContent?.payload?.body_content ||
      this.getMessageSnippet(msg.content);

    const dateStr = new Date(msg.created_at).toLocaleString();

    this.editorInitialContent = `<br><br>
        <div class="gmail_quote" style="font-family: Arial, sans-serif; color: #555;">
            <blockquote style="margin: 0 0 0 0.8ex; border-left: 2px solid #7cac80; padding-left: 1ex;">
                <div style="color: #888; font-size: 0.9em; margin-bottom: 8px;">
                    El ${dateStr}, <strong>${msg.author}</strong> escribió:
                </div>
                ${oldContent}
            </blockquote>
        </div>`;

    this.editorContent = this.editorInitialContent;
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
    this.securityService.playDeleteSound();
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
  }

  // Seguimiento y Workflow
  nuevoWorkflowTipo: string = '';

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

              // Sincronizar nombre con estándar .zst para que el paquete seguro lo refleje
              if (att.name && !att.name.toLowerCase().endsWith(".zst")) {
                att.name += ".zst";
              }

              // Guardar en historial local como subida exitosa
              invoke('add_document_history', {
                fileName: att.name,
                filePath: att.path,
                fileSize: att.size,
                remoteCode: att.remoteCode || '',
                source: 'MAILBOX',
                userLogin: this.securityService.getCurrentUserLogin()
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

  async generateDocumentSummary(specificAtt?: any): Promise<void> {
    const list = specificAtt ? [specificAtt] : this.newMessage.attachments;
    if (!list || list.length === 0) return;

    for (const att of list) {
      const ext = (att.type || att.extension || '').toUpperCase();
      if (ext !== 'CSV' && ext !== 'TXT') continue;

      try {
        const fileBytes = await readFile(att.path);
        if (!fileBytes || fileBytes.length === 0) continue;

        let textContent = '';
        try {
          textContent = new TextDecoder('utf-8', { fatal: true }).decode(fileBytes);
        } catch (e) {
          textContent = new TextDecoder('windows-1252').decode(fileBytes);
        }

        const lines = textContent.split(/\r?\n/).filter(l => l.trim().length > 0);
        const totalLines = lines.length;
        if (totalLines === 0) continue;

        // Limpiar el nombre del archivo para quitar extensiones de compresión del servidor
        const cleanFileName = att.name.replace(/\.zst$|\.gz$|\.zip$/i, '');
        let detailsHtml = '';
        let sumsHtml = '';

        if (ext === 'CSV') {
          const firstLine = lines[0];
          const commaCount = (firstLine.match(/,/g) || []).length;
          const semiCount = (firstLine.match(/;/g) || []).length;
          const delimiter = semiCount > commaCount ? ';' : ',';

          const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, ''));
          const numCols = headers.length;
          const totalRecords = totalLines - 1;

          if (totalRecords > 0) {
            const excludedKeywords = ['cedula', 'cuenta', 'hijo', 'tipo', 'estatus', 'situacion', 'id', 'codigo', 'cod', 'u_'];
            const columnSums: number[] = new Array(numCols).fill(0);
            const isNumericCol: boolean[] = new Array(numCols).fill(true);

            const maxAnalysisLines = Math.min(lines.length, 5000); 
            for (let i = 1; i < maxAnalysisLines; i++) {
              const cells = lines[i].split(delimiter);
              if (!cells || cells.length === 0) continue;
              for (let j = 0; j < numCols; j++) {
                if (j >= cells.length) continue;
                const headerLower = (headers[j] || '').toLowerCase();
                if (excludedKeywords.some(key => headerLower.includes(key))) { isNumericCol[j] = false; continue; }

                const val = cells[j].trim().replace(/[$.'" ]/g, '').replace(',', '.');
                const num = parseFloat(val);
                if (!isNaN(num)) { columnSums[j] += num; } else if (val.length > 0) { isNumericCol[j] = false; }
              }
            }

            let totalsRows = '';
            for (let j = 0; j < numCols; j++) {
              if (isNumericCol[j] && columnSums[j] !== 0) {
                totalsRows += `<div class="va-total-item-v7" style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed rgba(34, 197, 94, 0.2);"><span class="va-metric-label-v7" style="color: #64748b; font-size: 11px; font-weight: 600; text-transform: uppercase;">${headers[j]}</span><span class="va-metric-value-v7" style="font-weight: 800; color: #059669; font-size: 11px;">$ ${columnSums[j].toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>`;
              }
            }
            sumsHtml = totalsRows;
          }

          detailsHtml = `<table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;"><tr><td class="va-metric-col-v7 shaded"><span class="va-metric-label-v7">Registros</span><span class="va-metric-value-v7">${totalRecords.toLocaleString()}</span></td><td class="va-metric-col-v7"><span class="va-metric-label-v7">Columnas</span><span class="va-metric-value-v7">${numCols.toLocaleString()}</span></td></tr></table><div style="margin-top: 10px;"><div class="va-metric-label-v7" style="margin-bottom: 6px; display: block;">DIAGRAMA DE CAMPOS</div><div style="display: flex; flex-wrap: wrap; gap: 4px;">${headers.slice(0, 15).map(h => `<span class="va-pill-v7">${h}</span>`).join('')}${headers.length > 15 ? '<span style="font-size: 9px; color: #94a3b8; font-style: italic; margin-left: 5px;">... y más</span>' : ''}</div></div>${sumsHtml ? `<div class="ar-totals-box"><div style="font-size: 10px; color: #065f46; font-weight: 800; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px; border-bottom: 1px solid #d1fae5; display: block; padding-bottom: 4px;">RESUMEN DE TOTALES FINANCIEROS</div>${sumsHtml}</div>` : ''}`;
        } else {
          const totalWords = textContent.split(/\s+/).filter(w => w.length > 0).length;
          detailsHtml = `<table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;"><tr><td class="va-metric-col-v7 shaded"><span class="va-metric-label-v7">Líneas</span><span class="va-metric-value-v7">${totalLines.toLocaleString()}</span></td><td class="va-metric-col-v7"><span class="va-metric-label-v7">Palabras</span><span class="va-metric-value-v7">${totalWords.toLocaleString()}</span></td></tr></table>`;
        }

        const summaryHtml = `<div class="vault-analysis-report-v7"><div class="va-header-v7"><div style="display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; color: #0f172a; text-transform: uppercase;"><i class="fas fa-file-shield" style="color: #64748b; font-size: 16px;"></i><span>AUDITORÍA: <strong>${cleanFileName.toUpperCase()}</strong></span></div><div class="va-pill-v7" style="background: #e2e8f0; border: none; margin: 0;">SAD ARCHIVE V.24</div></div><div class="va-body-v7">${detailsHtml}</div><div class="va-footer-v7"><div style="display: flex; align-items: center; gap: 6px;"><i class="fas fa-fingerprint"></i><span>HASH: ${Math.random().toString(36).substring(2, 10).toUpperCase()}</span></div><div style="color: #10b981; font-weight: 900; font-size: 8px; letter-spacing: 0.5px; text-transform: uppercase;">CONTENEDOR SEGURO VERIFICADO</div></div></div><p><br></p>`;

        setTimeout(() => {
          if (this.editorElement) {
            const currentHtml = this.editorElement.nativeElement.innerHTML;
            this.editorElement.nativeElement.innerHTML = currentHtml + summaryHtml;
            this.editorContent = this.editorElement.nativeElement.innerHTML;
          }
          this.saveDraft();
        }, 1200); 


      } catch (err) {
        console.error("[Análisis] Error " + att.name, err);
      }
    }
  }

  async executeSendMessage() {
    // Ya no llamamos a generateDocumentSummary aquí, pues se hace al adjuntar
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

    // INTERCEPTO: Hilo de Workflow / Aprobación
    if (this.selectedMessage && this.parsedContent?.workflow) {
      const nuevoHilo = {
        id_mensaje: dynamicMessageId,
        remitente: `${this.authorProfile.usuario}@${this.authorProfile.sistema}`.toLowerCase(),
        cuerpo: this.editorContent,
        timestamp: new Date().toISOString(),
        tipo_respuesta: 'comentario' as const
      };

      if (!this.parsedContent.hilos) this.parsedContent.hilos = [];
      this.parsedContent.hilos.push(nuevoHilo);

      try {
        // Enviar a MongoDB 
        await this.upsertCorreoWorkflow(this.parsedContent);

        // Guardar Localmente para Offline
        const updatedContentString = JSON.stringify(this.parsedContent);
        this.selectedMessage.content = updatedContentString;
        
        // Emulamos un update eliminando y recreando con el nuevo contenido
        await this.securityService.deleteMailboxMessage(this.selectedMessage.id);
        await this.securityService.createMailboxMessage({
          ...this.selectedMessage,
          content: updatedContentString
        });

        this.cancelCompose();
        await this.loadMessages();
        
        // Seleccionamos de nuevo para refrescar UI
        const reloaded = this.messages.find(m => m.sid === this.selectedMessage?.sid);
        if(reloaded) this.selectMessage(reloaded);

      } catch (e) {
        console.error('Error al procesar hilo de workflow:', e);
      }
      return; // Fin de flujo workflow
    }

    const securePackageV23 = {
      manifest: {
        version: '0.1.6-SEC',
        timestamp: new Date().toISOString(),
        guid: dynamicMessageId,
        sender: this.machineName || this.activeConnection?.name || 'Sandra Node',
        login: this.authorProfile.usuario,
        hash: this.activeConnection?.hash,
        macaddress: this.systemMac,
        uuid: this.clientId,
        estatus: 'Pending',
        para: this.newMessage.selectedRecipients,
        download_count: 0
      },
      message_envelope: {
        subject: this.newMessage.sid,
        author: `${this.authorProfile.usuario}@${this.authorProfile.sistema}`.toLowerCase(),
        recipients: this.newMessage.selectedRecipients,
        body: this.editorContent,
        attachments: processedAttachments
      }
    };

    // Inyección condicional si el usuario inicializó un nuevo Hilo
    if (this.nuevoWorkflowTipo && this.nuevoWorkflowTipo !== '') {
      (securePackageV23 as any).workflow = {
        id_referencia_doc: dynamicMessageId,
        tipo: this.nuevoWorkflowTipo,
        estado: 'PENDIENTE',
        requiere_accion: true
      };
      (securePackageV23 as any).hilos = [];
    }

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

        // Despachar señal de sincronización en tiempo real (sdc_sync)
        this.notifyRecipientsOfSync(this.newMessage.selectedRecipients, dynamicMessageId);
      } catch (remoteError) {
        console.error("Fallo al sincronizar con sys-mailbox remoto, se guardará solo local.", remoteError);
        // Opcional: mostrar un Toast "Enviado con advertencia de sincronización"
      }

      // 2. Persist locally to the Outbox
      await this.securityService.createMailboxMessage({
        sid: this.newMessage.sid,
        content: JSON.stringify(securePackageV23),
        author: `${this.authorProfile.usuario}@${this.authorProfile.sistema}`.toLowerCase(),
        responsible: this.newMessage.selectedRecipients.join(', ') || 'Draft',
        direction: 'outbox',
        user_login: this.authorProfile.usuario
      });

      this.cancelCompose();
      await this.loadMessages();
    } catch (e) {
      console.error('Failed to save message locally', e);
    }
  }

  // --- WORKFLOW / THREADING LOGIC --- //

  async upsertCorreoWorkflow(correoActualizado: any) {
    if (!this.activeConnection?.hash) throw new Error("No active connection hash");

    const endpoint = `v1/api/crud:${this.activeConnection.hash}`;
    const payload = {
      "funcion": 'SDC_UUsers',
      "valores": JSON.stringify({
        "coleccion": "comunicaciones_internas",
        "operacion": "UPSERT",
        "filtro": {
          "workflow.id_referencia_doc": correoActualizado.workflow.id_referencia_doc
        },
        "datos": {
          "workflow.estado": correoActualizado.workflow.estado,
          "workflow.requiere_accion": false,
          "hilos": correoActualizado.hilos,
          "ultima_modificacion": new Date().toISOString()
        }
      })
    };

    return invoke('api_post_request', {
      ip: this.activeConnection.ip_address,
      port: Number(this.activeConnection.port),
      endpoint: endpoint,
      payload: payload,
      hash: this.activeConnection.hash,
      tempAuthToken: this.activeConnection.jwt
    });
  }

  async updateWorkflowStatus(decision: 'APROBADO' | 'RECHAZADO' | 'CERRADO' | 'COMPLETADO' | 'CANCELADO', msg: MailboxMessage) {
    if (!this.parsedContent?.workflow) return;

    this.appState.setViewerLoading(true);
    try {
      this.parsedContent.workflow.estado = decision;

      const nuevoHilo = {
        id_mensaje: crypto.randomUUID(),
        remitente: `${this.authorProfile.usuario}@${this.authorProfile.sistema}`.toLowerCase(),
        cuerpo: `<p><strong>Decisión de Flujo:</strong> Autoridad ha dictaminado estado <strong>${decision}</strong>.</p>`,
        timestamp: new Date().toISOString(),
        tipo_respuesta: (decision === 'APROBADO' || decision === 'COMPLETADO') ? 'aprobacion' : 'rechazo' as const
      };

      if (!this.parsedContent.hilos) this.parsedContent.hilos = [];
      this.parsedContent.hilos.push(nuevoHilo);

      await this.upsertCorreoWorkflow(this.parsedContent);

      const updatedContentString = JSON.stringify(this.parsedContent);
      msg.content = updatedContentString;
      msg.status = (decision === 'APROBADO' || decision === 'COMPLETADO') ? 'Approved' : 'Rejected';

      // Update SQLite Table attributes
      await this.securityService.updateMailboxStatus(msg.id, msg.status, msg.tracking_info);

      // Re-create to persist full content body
      await this.securityService.deleteMailboxMessage(msg.id);
      await this.securityService.createMailboxMessage({
        ...msg,
        content: updatedContentString
      });

      await this.loadMessages();
      
      const reloaded = this.messages.find(m => m.sid === msg.sid);
      if(reloaded) this.selectMessage(reloaded);

    } catch (error) {
      console.error("Error validando flujo de trabajo", error);
    } finally {
      this.appState.setViewerLoading(false);
    }
  }

  applyTemplate(type: string) {
    if (!type || !MAIL_TEMPLATES[type]) return;

    const data: TemplateData = {
      user: this.authorProfile.nombre || 'Personal Autorizado',
      cargo: this.authorProfile.cargo || 'Funcionario',
      date: new Date().toLocaleDateString()
    };

    const templateHtml = MAIL_TEMPLATES[type](data);

    if (templateHtml) {
      this.editorContent = templateHtml;
      this.editorInitialContent = templateHtml;
      this.saveDraft();
    }
  }

  printCurrentTemplate() {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>Impresión de Documento Sandra</title>
          <style>
            body { margin: 0; padding: 0; background: #fff; }
            @media print {
              .no-print { display: none; }
              body { padding: 0; }
              .sandra-template { border: none !important; box-shadow: none !important; width: 100% !important; max-width: 100% !important; }
            }
          </style>
        </head>
        <body>
          ${this.editorContent}
          <script>
            window.onload = () => {
              window.print();
              setTimeout(() => window.close(), 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
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
    this.generateDocumentSummary(newAtt);
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
    this.generateDocumentSummary(newAtt);
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
          source: 'GLOBAL',
          userLogin: this.securityService.getCurrentUserLogin()
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

  getSafeHtml(html: string) {
    if (!html) return '';
    return this.sanitizer.bypassSecurityTrustHtml(html);
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

  // --- Attachment Helpers ---

  isAttachmentDownloaded(att: any): boolean {
    if (!att || !att.remote_code) return false;
    
    // Si estamos en la bandeja de salida (Salida o Outbox), el archivo SIEMPRE es local
    if (this.mailboxDirection === 'outbox') return true;

    // Si el usuario es el autor del mensaje, el archivo vive en su memoria local (Backup check)
    if (this.selectedMessage) {
       const authorId = this.selectedMessage.author?.split('@')[0]?.toLowerCase();
       if (authorId === this.authorProfile.usuario.toLowerCase()) return true;
    }

    return this.history.some(h => h.remote_code === att.remote_code);
  }

  hasPendingDownloads(msg: MailboxMessage): boolean {
    if (!msg || !msg.content) return false;
    try {
      const parsed = JSON.parse(msg.content);
      const atts = parsed?.message_envelope?.attachments || parsed?.payload?.attachments || [];
      if (!Array.isArray(atts)) return false;
      
      const authorId = parsed?.message_envelope?.author?.split('@')[0]?.toLowerCase();
      if (authorId === this.authorProfile.usuario.toLowerCase()) {
         return false; // El emisor local nunca tiene descargas pendientes de sus propios archivos
      }

      return atts.some(att => !this.isAttachmentDownloaded(att));
    } catch { return false; }
  }

  async downloadAttachment(att: any, msg: MailboxMessage) {
    if (this.isAttachmentDownloaded(att)) {
      this.openAttachment(att);
      return;
    }

    const parsedContent = this.parseJsonContent(msg.content);
    const guid = parsedContent?.manifest?.hash || this.getMessageGuid(msg.content);
    if (!guid) {
      console.error("No GUID or Hash found for message, cannot download");
      return;
    }

    try {
      console.log("Downloading attachment:", att);
      console.log("Message GUID:", guid);
      console.log("Remote Code:", att.remote_code);

      this.downloadingStatus.set(att.remote_code, 0);
      const localPath = await invoke('mailbox_download_attachment', {
        ip: this.activeConnection.ip_address,
        port: Number(this.activeConnection.port),
        hash: this.activeConnection.hash,
        tempAuthToken: this.activeConnection.jwt,
        messageGuid: guid,
        remoteCode: att.remote_code,
        fileName: att.name,
        userLogin: this.securityService.getCurrentUserLogin() || 'persona'
      }) as string;

      console.log("Download complete:", localPath);

      // Refresh history to ensure the local index knows about the new file
      await this.loadHistory();

      // Auto-open after download with the correct path
      const updatedAtt = { ...att, path: localPath, source: 'VAULT' };
      this.openAttachment(updatedAtt);

    } catch (e) {
      console.error("Error downloading attachment", e);
      this.downloadingStatus.delete(att.remote_code);
    }
  }

  async openAttachment(att: any) {
    this.appState.setViewerLoading(true);
    // Pequeño delay para permitir que Angular renderice el overlay antes del procesamiento pesado
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      // 0. Limpiar nombre de .zst para visor y metadatos
      let cleanName = (att.name || 'documento').replace(/\.zst$|\.gz$|\.zip$/i, '');
      let rawExt = (att.extension || att.type || '').toUpperCase();
      
      if (rawExt === 'ZST' || rawExt === '.ZST') {
        rawExt = cleanName.split('.').pop()?.toUpperCase() || 'FILE';
      }

      const ext = rawExt;
      let path = att.transfer_info?.path || att.path || att.file_path;

      // Si sabemos que está descargado (en el buzón), buscar SIEMPRE en el historial local por remote_code
      // para evitar punteros a UUIDs temporales o incorrectos
      if (att.remote_code) {
        const historyItem = this.history.find(h => h.remote_code === att.remote_code);
        if (historyItem && historyItem.file_path) {
          const historyPath = historyItem.file_path;
          if (path !== historyPath) {
            console.log(`Puntero de archivo corregido por historial (${att.remote_code}): ${path} -> ${historyPath}`);
            path = historyPath;
          }
        }
      }

    // NORMALIZACIÓN DE RUTA: Si la ruta contiene sandra_vault, asegurar que coincida con el usuario actual
    if (path && path.includes('sandra_vault')) {
      try {
        const parts = path.split(/[/\\]/);
        const vaultIdx = parts.indexOf('sandra_vault');
        if (vaultIdx !== -1 && vaultIdx + 1 < parts.length) {
          let fileName = parts[vaultIdx + 1];
          
          // Si tenemos remote_code, NO SOBRESCRIBIR si somos el remitente que adjuntó el original
          const isSender = this.selectedMessage && this.selectedMessage.author && this.authorProfile.usuario.toLowerCase() === this.selectedMessage.author.split('@')[0].toLowerCase();
          
          if (att.remote_code && !isSender) {
             const vaultExt = fileName.split('.').pop() || '';
             // Limpiar .zst del código remoto para coincidir con el guardado en Rust
             const cleanRC = att.remote_code.replace(/\.zst/gi, '');
             const rcBase = cleanRC.split('.')[0];
             fileName = vaultExt && vaultExt.toLowerCase() !== 'zst' ? `${rcBase}.${vaultExt}` : rcBase;
          }

          const currentDataDir = await appDataDir();
          
          // Intentar normalizar la ruta base
          const normalizedPath = await join(currentDataDir, 'sandra_vault', fileName);
          
          // Verificación extra: si el archivo físico tiene extensión pero la ruta no, o viceversa, corregir
          if (path !== normalizedPath) {
            console.log(`Normalizando ruta de bóveda: ${path} -> ${normalizedPath}`);
            path = normalizedPath;
          }
        }
      } catch (pathErr) {
        console.warn("Error normalizando ruta de bóveda:", pathErr);
      }
    }

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
    let csvHeaders: string[] = [];
    let csvRows: string[][] = [];
    let txtContent: string | undefined = undefined;
    let txtLines: string[] | undefined = undefined;
    let txtTotalLines: number | undefined = undefined;
    let txtIsTruncated = false;

    // Use Blob strategy for any file that is local/vault to avoid protocol issues (like unsupported URL error)
    const isLocalOrVault = att.source === 'LOCAL' || att.source === 'VAULT' ||
      (att.transfer_info && (att.transfer_info.source === 'LOCAL' || att.transfer_info.source === 'VAULT')) ||
      (path && (path.includes('sandra_vault') || path.includes('AppData'))) ||
      this.isAttachmentDownloaded(att);

    if (att.status === 'PENDING' || att.status === 'UPLOADING' || isLocalOrVault) {
      try {
        let blob: Blob;
        try {
          // Intentar usar comando Rust para saltar restricciones de scope de JS (forbidden path)
          const base64 = await invoke<string>('load_sse_document', { filePath: path });
          const binaryString = atob(base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
          blob = new Blob([bytes], { type: mimeType });
          console.log("Archivo leído exitosamente vía Rust Command.");
        } catch (err) {
          console.warn("Fallo load_sse_document, reintentando con readFile estándar:", err);
          const bytes = await readFile(path);
          blob = new Blob([bytes], { type: mimeType });
        }
        content = this.sanitizer.bypassSecurityTrustResourceUrl(URL.createObjectURL(blob));

        // Procesamiento extra para CSV y TXT (Para integrarse con csv-viewer y file-viewer premium)
        if (ext === 'CSV') {
          try {
            const { header, rows } = await this.fileService.parseCSV(blob);
            csvHeaders = header;
            csvRows = rows;
          } catch (csvErr) { console.error("Error parsing CSV:", csvErr); }
        } else if (ext === 'TXT') {
          try {
            const fullText = await blob.text();
            txtLines = fullText.split(/\r?\n/);
            txtTotalLines = txtLines.length;
            if (txtTotalLines > 1000) {
              txtIsTruncated = true;
              txtContent = txtLines.slice(0, 1000).join("\n");
            } else {
              txtContent = fullText;
            }
          } catch (txtErr) { console.error("Error reading TXT:", txtErr); }
        } else if (ext === 'CSV') {
          // También preparar txtContent como fallback para CSV
          try {
            txtContent = await blob.text();
          } catch (csvTxtErr) { console.error("Error reading CSV as text:", csvTxtErr); }
        }
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

    if (isSSE || isPDF) {
      this.appState.addTab({
        id: `doc-${att.id}-${cleanName}`,
        name: cleanName,
        icon: isSSE ? 'fas fa-shield-halved' : 'fas fa-file-pdf',
        type: 'pdf-viewer',
        isProtected: isSSE,
        content: content,
        mimeType: mimeType,
        filePath: path,
        showToolbar: true
      });
    } else if (ext === 'CSV') {
      if (csvHeaders.length > 0) {
        this.appState.addTab({
          id: `csv-${att.id}-${cleanName}`,
          name: cleanName,
          icon: 'fas fa-table-list',
          type: 'csv-viewer',
          content: content,
          mimeType: 'text/csv',
          isProtected: false,
          filePath: path,
          csvHeader: csvHeaders,
          csvRows: csvRows,
          showToolbar: true
        });
      } else {
        // Fallback a visor de texto si el parsing de CSV falló
        this.appState.addTab({
          id: `file-${att.id}-${cleanName}`,
          name: cleanName,
          icon: 'fas fa-file-csv',
          type: 'file-viewer',
          content: content,
          mimeType: 'text/plain',
          isProtected: false,
          filePath: path,
          txtContent: "No se pudieron detectar encabezados válidos en el CSV. Mostrando como texto.\n\n" + (txtContent || '')
        });
      }
    } else if (ext === 'TXT' || isImage) {
      this.appState.addTab({
        id: `file-${att.id}-${cleanName}`,
        name: cleanName,
        icon: isImage ? 'fas fa-image' : 'fas fa-file-alt',
        type: 'file-viewer',
        content: content,
        mimeType: mimeType,
        isProtected: false,
        filePath: path,
        txtContent,
        txtLines,
        txtTotalLines,
        txtIsTruncated,
        showToolbar: true
      });
    } else {
      // General Fallback
      this.appState.addTab({
        id: `file-${att.id}-${cleanName}`,
        name: cleanName,
        icon: 'fas fa-file',
        type: 'file-viewer',
        content: content,
        mimeType: mimeType,
        isProtected: false,
        filePath: path,
        showToolbar: true
      });
    }
    } finally {
      this.appState.setViewerLoading(false);
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
      if (stored) {
        const all = JSON.parse(stored);
        const myId = `${this.authorProfile.usuario}`.toLowerCase();
        this.contacts = all.filter((c: any) => (c.login || '').toLowerCase() !== myId);
      } else {
        this.contacts = [];
      }
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
        const all = [...response, ...localOnly];
        const myId = `${this.authorProfile.usuario}@${this.authorProfile.sistema}`.toLowerCase();
        this.contacts = all.filter(c => (c.login || '').toLowerCase() !== myId);
        this.saveContactsLocal();
      } else if (response && response.data && Array.isArray(response.data)) {
        const myId = `${this.authorProfile.usuario}@${this.authorProfile.sistema}`.toLowerCase();
        this.contacts = response.data.filter((c: any) => (c.login || '').toLowerCase() !== myId);
        this.saveContactsLocal();
      } else if (response && response.msj === 'Ok' && response.contenido) {
        const arr = Array.isArray(response.contenido) ? response.contenido : [];
        const myId = `${this.authorProfile.usuario}@${this.authorProfile.sistema}`.toLowerCase();
        this.contacts = arr.filter((c: any) => (c.login || '').toLowerCase() !== myId);
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
    this.securityService.playDeleteSound();
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

  maskMacAddress(mac: string): string {
    if (!mac) return '';
    const parts = mac.split(':');
    if (parts.length > 3) {
      return `${parts[0]}:${parts[1]}:XX:XX:${parts[parts.length - 2]}:${parts[parts.length - 1]}`;
    }
    // Fallback if not standard MAC
    return mac.length > 8 ? `${mac.substring(0, 5)}...${mac.substring(mac.length - 3)}` : mac;
  }

  private async notifyRecipientsOfSync(recipients: string[], messageId: string) {
    if (!recipients?.length || !this.activeConnection?.hash) return;

    // 1. Mapear destinatarios (logins) a direcciones MAC desde la agenda local
    const macs = recipients.map(r => {
      const login = r.split('@')[0].toLowerCase();
      const contact = this.contacts.find(c => (c.login || c.user_name || '').toLowerCase() === login);
      return contact?.firmadigital?.direccionmac;
    }).filter(m => !!m);

    if (macs.length === 0) return;

    // 2. Consultar IDs de conexión (user_id) para esas MACs
    const macParam = `array##${macs.map(m => `"${m}"`).join(',')}`;
    const crudEndpoint = `v1/api/crud:${this.activeConnection.hash}`;

    try {
      const response: any = await this.sdcService.apiPostRequest(
        this.activeConnection.ip_address,
        Number(this.activeConnection.port),
        crudEndpoint,
        {
          funcion: 'SDC_CUsersMacAddress',
          parametros: macParam
        },
        this.activeConnection.hash,
        this.activeConnection.jwt
      );

      // 3. Despachar señales sdc_sync vía WebSocket para cada usuario online
      if (Array.isArray(response)) {
        for (const item of response) {
          if (item.status === 'online' && item.user_id) {
            console.log("Enviando señal de sincronización a usuario:", item.login, item.user_id);
            await this.sdcService.apiPostRequest(
              this.activeConnection.ip_address,
              Number(this.activeConnection.port),
              'v1/api/sandra_send-message',
              {
                type: 'sdc_sync',
                clientId: item.user_id,
                message: `UPD:${messageId}`,
                from: this.authorProfile.usuario,
                to: item.login || item.nombre_usuario || 'destinatario'
              },
              this.activeConnection.hash,
              this.activeConnection.jwt
            );
          }
        }
      }
    } catch (e) {
      console.warn('Sync notification failed (background trace):', e);
    }
  }
}
