import { Component, OnInit, NgZone, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl, Title } from '@angular/platform-browser';
import { invoke } from "@tauri-apps/api/core";
import { SdcService } from './core/services/sdc.service';
import { LoggerService } from './core/services/logger.service';
import { SystemStats } from './core/models/telemetry.model';
import { AppStateService, Tab } from './core/services/app-state.service';
import { Observable } from 'rxjs';

import { listen } from "@tauri-apps/api/event";
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { ConnectionsComponente } from './pages/connections/connections.component';
import { SecurityComponent } from './pages/security/security.component';
import { MonitorComponent } from './pages/monitor/monitor.component';
import { StorageComponent } from './components/storage/storage.component';
import { InspectorComponent } from './components/inspector/inspector.component';
import { ConfigComponent } from './components/config/config.component';

type ConnectionStatus = 'Conectado' | 'Reintentando' | 'Suspendido' | 'Desconectado';

interface DesktopApp {
  id: string;
  installed?: boolean;
  repo?: string;
  name: string;
  icon: string;
  action?: string;
  externalUrl?: string; // Soporte para URL remotas o locales fuera del sandra-app://
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, SidebarComponent, DashboardComponent, ConnectionsComponente, SecurityComponent, MonitorComponent, StorageComponent, InspectorComponent, ConfigComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  stats: SystemStats | null = null;
  greetingMessage = "";
  networkInfo: string[] = [];

  currentTime = new Date();
  currentDateStr = '';
  currentTimeStr = '';
  showControlPanel = false;

  tasks = [
    { title: 'Sincronización Nodos', time: '10:42 AM', status: 'active' },
    { title: 'Respaldo Diario', time: '02:00 PM', status: 'pending' },
    { title: 'Actualización Certs', time: '04:30 PM', status: 'pending' }
  ];

  wsStatus: ConnectionStatus = 'Desconectado';
  attemptNumber: number = 0;

  installModal = {
    show: false,
    title: '',
    message: '',
    error: null as string | null,
    success: false
  };

  confirmModal = {
    show: false,
    title: '',
    message: '',
    appToDelete: null as any
  };

  showDbModal = false;
  config = {
    logs: {
      enabled: true,
      reportToCreator: false
    },
    theme: 'sandra',
    access: {
      remoteControl: true,
      networkBroadcast: false
    },
    updates: {
      autoUpdate: true
    }
  };

  apps: DesktopApp[] = [
    { name: 'Gestión Doc.', icon: 'fas fa-folder-open', id: 'gdoc', installed: true, repo: "https://github.com/code-epic/gdoc" },
    { name: 'Sicoex', icon: 'fas fa-user-plus', id: 'bdv', installed: true, repo: "https://github.com/code-epic/gdoc.proceedings" },
    { name: 'Nómina', icon: 'fas fa-file-invoice-dollar', id: 'nomina-app', installed: false, repo: "" },

    // Nuevos Paradigmas de Navegación (Remoto / Localhost)
    { name: 'Google', icon: 'fas fa-globe', id: 'google', installed: true, externalUrl: "https://google.co.ve" },
    { name: 'WikiPedia', icon: 'fas fa-laptop-code', id: 'wikipedia', installed: true, externalUrl: "https://wikipedia.org" },

    { name: 'Panel de Control', icon: 'fas fa-cogs', action: 'toggleCP', id: 'web-panel', installed: true, externalUrl: "http://localhost:4201" },
    { name: 'Divisas', icon: 'fas fa-file', action: 'toggleCP', id: 'cmpdivisas', installed: true, externalUrl: "http://localhost:4200/cmpdivisas" },
    { name: 'GDoc. Localhost', icon: 'fas fa-folder-open', id: 'gdoc', installed: true, externalUrl: "http://localhost:4300" },
  ];

  // Connections
  availableConnections: any[] = [];
  activeConnection: any = null;
  clientId: string = '';

  activeTabId$: Observable<string>;
  openTabs$: Observable<Tab[]>;
  rightSidebarOpen$: Observable<boolean>;
  leftSidebarOpen$: Observable<boolean>;
  currentTabId: string = 'dashboard';

  isInspectorOpen = false;

  constructor(
    public appState: AppStateService,
    private sdcService: SdcService,
    private logger: LoggerService,
    private zone: NgZone,
    private sanitizer: DomSanitizer,
    private titleService: Title
  ) {
    this.activeTabId$ = this.appState.activeTabId$;
    this.openTabs$ = this.appState.openTabs$;
    this.rightSidebarOpen$ = this.appState.rightSidebarOpen$;
    this.leftSidebarOpen$ = this.appState.leftSidebarOpen$;

    this.rightSidebarOpen$.subscribe(val => this.isInspectorOpen = val);

    this.logger.initialize();

    // -- Dynamic Title Logic --
    this.activeTabId$.subscribe(id => {
      this.currentTabId = id;
      this.updateTitle(id);
      // Aplicar reglas de sidebar al cambiar de pestaña
      setTimeout(() => this.checkSidebarResponsive(window.innerWidth), 0);

      // Si volvemos al dashboard, refrescar datos inmediatamente para no esperar 5 min
      if (id === 'dashboard') {
        this.refreshStats();
      }
    });

    setInterval(() => {
      this.currentTime = new Date();
      this.updateDateTime();
    }, 1000);
    this.updateDateTime();
  }


  // ... (UpdateTitle and ReloadActiveIframe remain same) ...

  @HostListener('window:keydown', ['$event'])
  async handleKeyboardEvent(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault();

      const contextId = ['dashboard', 'connections', 'security', 'monitor', 'system'].includes(this.currentTabId)
        ? 'App.SDC'
        : this.currentTabId;

      if (!this.isInspectorOpen) {
        // Opening: Just toggle. Do NOT clear logs.
        this.toggleRightSidebar();
      } else {
        // Closing: Check for logs for THIS app
        if (this.logger.hasLogs(contextId)) {
          if (confirm('Hay logs en el inspector para esta aplicación. ¿Desea guardarlos antes de cerrar?')) {
            await this.logger.saveAllLogs(contextId);
          }
        }
        this.toggleRightSidebar();
      }
    }
  }

  // Modal Log State
  showSaveLogModal = false;
  tabIdToClose: string | null = null;

  async closeTab(tabId: string, evt: Event) {

    evt.stopPropagation();
    evt.preventDefault();

    // Silent Mode Check: XHR created for THIS tab?
    if (this.logger.hasXhrLogsForApp(tabId)) {
      this.tabIdToClose = tabId;
      this.showSaveLogModal = true;
      return;
    }

    this.appState.closeTab(tabId);
  }

  selectTab(tabId: string) {
    this.appState.setActiveTab(tabId);
  }

  async confirmCloseTab(shouldSave: boolean) {
    if (this.tabIdToClose) {
      if (shouldSave) {
        await this.logger.saveAllLogs(this.tabIdToClose);
      } else {
        // If discarding, we should probably clear them to avoid them lingering?
        // Or just close. The user said "No guardar".
        this.logger.clearLogs(this.tabIdToClose);
      }
      this.appState.closeTab(this.tabIdToClose);
    }
    this.showSaveLogModal = false;
    this.tabIdToClose = null;
  }


  updateTitle(tabId: string) {
    if (tabId === 'dashboard') {
      this.titleService.setTitle('Sandra Desktop Container');
      return;
    }
    // Find tab name
    const tabs = this.appState.getTabsSnapshot();
    const activeTab = tabs.find(t => t.id === tabId);
    if (activeTab) {
      this.titleService.setTitle(`${activeTab.name} - Sandra DC`);
    } else {
      // Fallback for known static pages if any, or default
      const staticName = tabId.charAt(0).toUpperCase() + tabId.slice(1);
      this.titleService.setTitle(`${staticName} - Sandra DC`);
    }
  }

  reloadActiveIframe() {
    if (this.currentTabId === 'dashboard') return;

    // Find the iframe element by ID
    const iframeId = 'iframe-' + this.currentTabId;
    const iframe = document.getElementById(iframeId) as HTMLIFrameElement;

    if (iframe) {
      console.log(`Reloading iframe: ${iframeId}`);
      // Técnica compatible con CORS: reasignar el src
      // Esto fuerza al navegador a recargar el iframe incluso si es de otro origen
      const currentSrc = iframe.src;
      iframe.src = currentSrc;
    } else {
      console.warn(`Iframe not found for reloading: ${iframeId}`);
    }
  }

  // Messaging to Iframes
  onIframeLoad(tabId: string) {
    console.log(`[Iframe Loaded] Sending context to ${tabId}`);
    this.sendContextToIframe(tabId);
  }

  sendContextToIframe(tabId: string) {
    const iframeId = 'iframe-' + tabId;
    const iframe = document.getElementById(iframeId) as HTMLIFrameElement;

    if (iframe && iframe.contentWindow) {
      const contextPayload = {
        system: this.stats, // mac_address, os_info, disk...
        network: {
          ips: this.networkInfo
        },
        config: {
          clientId: this.clientId,
          // Puedes agregar más config aquí
        },
        timestamp: new Date().toISOString()
      };

      console.log(`[PostMessage] Sending NETWORK_CONTEXT to ${tabId}`, contextPayload);

      iframe.contentWindow.postMessage({
        type: 'NETWORK_CONTEXT', // Tipo de mensaje acordado
        payload: contextPayload
      }, '*'); // TODO: Restringir origen en producción si es necesario
    }
  }

  async ngOnInit() {
    this.checkSidebarResponsive(window.innerWidth);
    this.refreshStats();
    // Modificado: Ejecutar solo si estamos en Dashboard y cada 5 minutos
    setInterval(() => {
      if (this.currentTabId === 'dashboard') {
        this.refreshStats();
      }
    }, 300000);
    this.initStatusListener();
    this.loadNetwork();
    this.appState.onConfigToggle.subscribe(() => {
      this.showControlPanel = !this.showControlPanel;
      if (this.showControlPanel) this.loadConnections();
    });

    // Global Connection Status Listener
    await listen('connection-status', (event: any) => {
      const s = event.payload as string;
      if (s === 'connected') {
        this.wsStatus = 'Conectado';
      } else if (s === 'disconnected') {
        this.wsStatus = 'Desconectado';
      } else if (s === 'connecting') {
        this.wsStatus = 'Reintentando'; // Or generic connecting state
      }
      this.zone.run(() => { }); // Update UI
    });

    // Initialize Client ID and Connections
    this.clientId = await this.sdcService.getClientId();
    await this.loadConnections();
  }

  async loadConnections() {
    try {
      this.availableConnections = await this.sdcService.getConnections();
      this.activeConnection = this.availableConnections.find(c => c.is_connected) || null;

      // Verificar estado real si hay una conexión activa marcada
      if (this.activeConnection) {
        await this.verifyActiveConnection();
      } else {
        this.wsStatus = 'Desconectado';
      }

    } catch (e) {
      console.error("Error loading connections", e);
    }
  }

  // Verificar estado del host (Ping/TCP Check) tal como en Configurar Conexión
  async verifyActiveConnection() {
    if (!this.activeConnection) return;

    try {
      const isUp = await invoke('verify_connection_status', {
        ip: this.activeConnection.ip_address,
        port: Number(this.activeConnection.port)
      });

      if (isUp) {
        // Si el host responde y estaba marcado como conectado
        this.wsStatus = 'Conectado';
      } else {
        // Host no responde
        this.wsStatus = 'Reintentando';
      }
    } catch (e) {
      console.error("Error verifying connection status", e);
      this.wsStatus = 'Desconectado';
    }
  }

  async activateConnectionGlobal(conn: any) {
    if (this.activeConnection && this.activeConnection.id === conn.id) return; // Already active

    // Deactivate previous if any? connect_to_server handles this in DB.
    // We invoke connect_to_server which sets is_connected=1 and starts WSS.

    // Optimistic UI update
    this.activeConnection = conn;
    try {
      await this.sdcService.connectToServer(conn, this.clientId);
      // Refresh list to sync is_connected flags from DB
      await this.loadConnections();
    } catch (e) {
      console.error("Error activating connection", e);
      alert("Error al activar conexión: " + e);
    }
  }

  async disconnectConnection(conn: any) {
    if (!conn) return;
    try {
      await this.sdcService.disconnectFromServer(conn, this.clientId);
      this.activeConnection = null;
      this.wsStatus = 'Desconectado'; // Optimistic update

      // Update the connection in the list to reflect disconnected state 
      // (assuming getConnections reads from DB where flag is updated)
      await this.loadConnections();
    } catch (e) {
      console.error("Error disconnecting", e);
      alert("Error al desconectar: " + e);
    }
  }

  // ... other methods ...

  openApp(app: any) {
    let rawUrl = '';

    if (app.externalUrl) {
      rawUrl = app.externalUrl;
      console.log(`🌍 [External Nav] Direct (No Proxy) ${app.name} -> ${rawUrl}`);
      this.logger.log('FETCH', `GET ${rawUrl} [200]`, 'Navigation', app.id);
    } else {
      rawUrl = `sandra-app://localhost/${app.id}/`;
      console.log(`🚀 [Local Nav] Opening ${app.name} via ${rawUrl} (Proxy Active: ${!!this.activeConnection})`);
    }

    const safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(rawUrl);
    this.appState.addTab({ id: app.id, name: app.name, icon: app.icon, url: safeUrl });
  }

  // ... rest of class ...

  get statusColor(): string {
    switch (this.wsStatus) {
      case 'Conectado': return '#66BB6A';
      case 'Desconectado': return '#CFD8DC'; // Gray
      case 'Reintentando': return '#FFA726';
      case 'Suspendido': return '#EF5350';
      default: return '#CFD8DC';
    }
  }

  updateDateTime() {
    const now = this.currentTime;
    const months = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
    const day = now.getDate().toString().padStart(2, '0');
    const month = months[now.getMonth()];
    const year = now.getFullYear().toString().slice(-2);
    this.currentDateStr = `${day}${month}${year}`;
    this.currentTimeStr = now.toLocaleTimeString('es-ES', { hour12: false });
  }

  async initStatusListener() {
    await listen<{ status: string, attempt?: number }>('ws-status-update', (event) => {
      this.zone.run(() => {
        const payload = event.payload;
        switch (payload.status) {
          case 'Connected': this.wsStatus = 'Conectado'; this.attemptNumber = 0; break;
          case 'Retrying': this.wsStatus = 'Reintentando'; this.attemptNumber = payload.attempt || 0; break;
          case 'Suspended': this.wsStatus = 'Suspendido'; this.attemptNumber = 0; break;
          default: this.wsStatus = 'Desconectado';
        }
      });
    });
  }



  toggleLeftSidebar() { this.appState.toggleLeftSidebar(); }
  toggleRightSidebar() { this.appState.toggleRightSidebar(); }

  @HostListener('window:resize', ['$event'])
  onResize(event: any) {
    this.checkSidebarResponsive(window.innerWidth);
  }

  checkSidebarResponsive(width: number) {
    // Definir páginas estáticas donde el sidebar SI puede aparecer (sujeto a resolución)
    const staticPages = ['dashboard', 'connections', 'security', 'monitor'];

    // 1. Si NO es una página estática (Es una App corriendo), Ocultar siempre.
    if (!staticPages.includes(this.currentTabId)) {
      this.appState.setLeftSidebar(false);
      return;
    }

    // 2. Si es Dashboard/Estática, aplicar lógica responsiva por tamaño
    // Threshold adjusted to 1150px - Balanced point
    const responsiveThreshold = 1150;

    if (width < responsiveThreshold) {
      this.appState.setLeftSidebar(false);
    } else {
      this.appState.setLeftSidebar(true);
    }
  }



  switchToDashboard() { this.appState.setActiveTab('dashboard'); }

  dbStats: any = null;

  async refreshStats() {
    this.stats = await this.sdcService.getSystemTelemetry();
    try {
      this.dbStats = await this.sdcService.getDbStats();
    } catch (e) {
      console.error("Error fetching db stats", e);
    }
  }

  formatBytes(bytes: number): string {
    return (bytes / (1024 ** 3)).toFixed(2) + ' GB';
  }

  greet(event: SubmitEvent, name: string): void {
    event.preventDefault();
    invoke<string>("greet", { name }).then((text) => { this.greetingMessage = text; });
  }

  async loadNetwork() {
    try { this.networkInfo = await this.sdcService.getNetworkInfo(); } catch (err) { console.error("Error network:", err); }
  }

  async reboot() {
    try {
      const response = await this.sdcService.requestRemoteReboot();
      console.log(response);
    } catch (err) {
      alert("Error reboot: " + err);
    }
  }

  handleAppClick(app: DesktopApp) {
    if (app.action === 'toggleCP') {
      this.showControlPanel = !this.showControlPanel;
      if (this.showControlPanel) this.loadNetwork();
    } else {
      console.log(`Opening ${app.name}`);
    }
  }

  async DownloadAppRepo(app: any) {
    if (app.installed) {
      this.openApp(app);
    } else {
      this.installModal = { show: true, title: `Instalando ${app.name}`, message: 'Descargando...', error: null, success: false };
      try {
        await invoke('download_app_repo', { repoUrl: app.repo, folderName: app.id });
        app.installed = true;
        this.installModal.success = true;
        this.installModal.message = 'Instalado correctamente.';
        setTimeout(() => this.closeModal(), 2000);
      } catch (err: any) {
        this.installModal.error = typeof err === 'string' ? err : 'Error desconocido';
      }
    }
  }

  closeModal() { this.installModal.show = false; }

  async updateApp(app: any) {
    this.installModal = { show: true, title: `Actualizando ${app.name}`, message: 'Sincronizando...', error: null, success: false };
    try {
      await invoke('update_app_repo', { folderName: app.id });
      this.installModal.success = true;
      this.installModal.message = 'Actualizado correctamente.';
      setTimeout(() => this.closeModal(), 1500);
    } catch (err: any) {
      this.installModal.error = typeof err === 'string' ? err : 'Error al actualizar';
    }
  }

  async deleteApp(app: any) {
    this.confirmModal = { show: true, title: 'Desinstalar', message: `¿Eliminar ${app.name}?`, appToDelete: app };
  }

  cancelDelete() { this.confirmModal.show = false; this.confirmModal.appToDelete = null; }

  async confirmDelete() {
    const app = this.confirmModal.appToDelete;
    this.confirmModal.show = false;
    if (app) {
      this.installModal = { show: true, title: `Desinstalando ${app.name}`, message: 'Eliminando...', error: null, success: false };
      try {
        await invoke('delete_app_repo', { folderName: app.id });
        app.installed = false;
        this.installModal.success = true;
        this.installModal.message = 'Eliminado correctamente.';
        setTimeout(() => this.closeModal(), 1500);
      } catch (err: any) {
        this.installModal.error = typeof err === 'string' ? err : 'Error al eliminar';
      }
    }
  }

  showIpInfo() {
    if (this.networkInfo.length > 0) {
      alert(`Direcciones IP Detectadas:\n\n${this.networkInfo.join('\n')}`);
    } else {
      alert("No se detectaron direcciones IP.");
    }
  }

  showMacInfo() {
    if (this.stats && this.stats.mac_address) {
      alert(`Identidad del Sistema (MAC/ID):\n\n${this.stats.mac_address}\n\nNota: Si no se detecta la MAC física, se muestra el Hostname.`);
    } else {
      alert("Información de Identidad no disponible.");
    }
  }



  saveConfig() {
    console.log('Config guardada:', this.config);
    this.showControlPanel = false;
  }
}
