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
  parsedContent: any = null;
  showTrace: boolean = false;

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
  }

  selectMessage(msg: MailboxMessage) {
    this.selectedMessage = msg;
    this.parsedContent = this.parseJsonContent(msg.content);
    this.showTrace = false; // Reset toggle on selection
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
    if (att.type === 'SSE') {
      // Open in Secure Viewer Tab
      this.appState.addTab({
        id: `secure-doc-${att.name}`,
        name: att.name,
        icon: 'assets/icons/lock.svg',
        type: 'pdf-viewer', // Use pdf-viewer type which SecureViewer component handles
        isProtected: true,
        filePath: att.path // Virtual path/ID for backend retrieval
      });
    } else {
      // PDF Standard
      this.appState.addTab({
        id: `doc-${att.name}`,
        name: att.name,
        icon: 'assets/icons/pdf.svg',
        type: 'pdf-viewer',
        isProtected: false,
        filePath: att.path
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

  async deleteProxyRoute(id: number) {
    if (confirm('¿Está seguro de que desea eliminar esta ruta?')) {
      try {
        await this.securityService.deleteProxyRoute(id);
        await this.loadProxyRoutes();
      } catch (e) {
        console.error('Error al eliminar ruta', e);
      }
    }
  }
}
