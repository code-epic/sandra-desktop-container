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

type ConnectionStatus = 'Connected' | 'Retrying' | 'Suspended' | 'Disconnected';

interface DesktopApp {
  id: string;
  installed?: boolean;
  repo?: string;
  name: string;
  icon: string;
  action?: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, SidebarComponent, DashboardComponent, ConnectionsComponente, SecurityComponent, MonitorComponent, StorageComponent, InspectorComponent],
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

  wsStatus: ConnectionStatus = 'Disconnected';
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

  activeConfigTab: string = 'logs';
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
    { name: 'Carnetización', icon: 'fas fa-id-card', id: 'nomina-app', installed: false, repo: "" },
    { name: 'Fideicomiso.', icon: 'fas fa-hand-holding-usd', id: 'nomina-app', installed: false, repo: "" },
    { name: 'Panel de Control', icon: 'fas fa-cogs', action: 'toggleCP', id: 'nomina-app', installed: false, repo: "" },
    { name: 'Divisas', icon: 'fas fa-file', action: 'toggleCP', id: 'cmpdivisas', installed: true, repo: "https://code-epic.io/code-epic/cmpdivisas" }
  ];

  activeTabId$: Observable<string>;
  openTabs$: Observable<Tab[]>;
  rightSidebarOpen$: Observable<boolean>;
  leftSidebarOpen$: Observable<boolean>;
  currentTabId: string = 'dashboard';

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

    this.logger.initialize();

    // -- Dynamic Title Logic --
    this.activeTabId$.subscribe(id => {
      this.currentTabId = id;
      this.updateTitle(id);
    });

    setInterval(() => {
      this.currentTime = new Date();
      this.updateDateTime();
    }, 1000);
    this.updateDateTime();
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

  async ngOnInit() {
    this.refreshStats();
    setInterval(() => this.refreshStats(), 5000);
    this.initStatusListener();
    this.loadNetwork();
    this.appState.onConfigToggle.subscribe(() => this.showControlPanel = !this.showControlPanel);

    // Global Connection Status Listener
    await listen('connection-status', (event: any) => {
      const s = event.payload as string;
      if (s === 'connected') {
        this.wsStatus = 'Connected';
      } else if (s === 'disconnected') {
        this.wsStatus = 'Disconnected';
      } else if (s === 'connecting') {
        this.wsStatus = 'Retrying'; // Or generic connecting state
      }
      this.zone.run(() => { }); // Update UI
    });
  }

  get statusColor(): string {
    switch (this.wsStatus) {
      case 'Connected': return '#66BB6A';
      case 'Disconnected': return '#CFD8DC'; // Gray
      case 'Retrying': return '#FFA726';
      case 'Suspended': return '#EF5350';
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
          case 'Connected': this.wsStatus = 'Connected'; this.attemptNumber = 0; break;
          case 'Retrying': this.wsStatus = 'Retrying'; this.attemptNumber = payload.attempt || 0; break;
          case 'Suspended': this.wsStatus = 'Suspended'; this.attemptNumber = 0; break;
          default: this.wsStatus = 'Disconnected';
        }
      });
    });
  }



  toggleLeftSidebar() { this.appState.toggleLeftSidebar(); }
  toggleRightSidebar() { this.appState.toggleRightSidebar(); }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      this.toggleRightSidebar();
    }
  }

  switchToDashboard() { this.appState.setActiveTab('dashboard'); }

  async refreshStats() {
    this.stats = await this.sdcService.getSystemTelemetry();
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

  openApp(app: any) {
    const rawUrl = `sandra-app://localhost/${app.id}/`;
    const safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(rawUrl);
    this.appState.addTab({ id: app.id, name: app.name, icon: app.icon, url: safeUrl });
  }

  closeTab(tabId: string, event: Event) {
    event.stopPropagation();
    this.appState.closeTab(tabId);
  }

  saveConfig() {
    console.log('Config guardada:', this.config);
    this.showControlPanel = false;
  }
}
