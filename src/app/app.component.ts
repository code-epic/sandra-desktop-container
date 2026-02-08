import { Component, OnInit, NgZone, HostListener } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import {
  DomSanitizer,
  SafeResourceUrl,
  Title,
} from "@angular/platform-browser";
import { invoke } from "@tauri-apps/api/core";
import { SdcService } from "./core/services/sdc.service";
import { LoggerService } from "./core/services/logger.service";
import { SystemStats } from "./core/models/telemetry.model";
import { AppStateService, Tab } from "./core/services/app-state.service";
import { DownloadService } from "./core/services/download.service";
import { Observable } from "rxjs";
// import { PDFDocument, rgb, degrees } from 'pdf-lib'; // REMOVED: Now handled in DownloadService/ChildApp


import { listen } from "@tauri-apps/api/event";
import { SidebarComponent } from "./components/sidebar/sidebar.component";
import { DashboardComponent } from "./pages/dashboard/dashboard.component";
import { ConnectionsComponente } from "./pages/connections/connections.component";
import { SecurityComponent } from "./pages/security/security.component";
import { MonitorComponent } from "./pages/monitor/monitor.component";
import { StorageComponent } from "./components/storage/storage.component";
import { InspectorComponent } from "./components/inspector/inspector.component";
import { ConfigComponent } from "./components/config/config.component";
import { AppsComponent } from "./pages/apps/apps.component";
import { DesktopAppsService } from "./core/services/desktop-apps.service";
import { ChatComponent } from "./pages/chat/chat.component";
import { SecureViewerComponent } from "./components/secure-viewer/secure-viewer.component";

type ConnectionStatus =
  | "Conectado"
  | "Reintentando"
  | "Suspendido"
  | "Desconectado";

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
  selector: "app-root",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    SidebarComponent,
    DashboardComponent,
    ConnectionsComponente,
    SecurityComponent,
    MonitorComponent,
    StorageComponent,
    InspectorComponent,
    ConfigComponent,
    AppsComponent,
    ChatComponent,
    SecureViewerComponent,
  ],
  templateUrl: "./app.component.html",
  styleUrls: ["./app.component.css"],
})
export class AppComponent implements OnInit {
  stats: SystemStats | null = null;
  greetingMessage = "";
  networkInfo: string[] = [];

  currentTime = new Date();
  currentDateStr = "";
  currentTimeStr = "";
  showControlPanel = false;

  tasks = [
    { title: "Sincronización Nodos", time: "10:42 AM", status: "active" },
    { title: "Respaldo Diario", time: "02:00 PM", status: "pending" },
    { title: "Actualización Certs", time: "04:30 PM", status: "pending" },
  ];

  wsStatus: ConnectionStatus = "Desconectado";
  attemptNumber: number = 0;

  installModal = {
    show: false,
    title: "",
    message: "",
    error: null as string | null,
    success: false,
  };

  confirmModal = {
    show: false,
    title: "",
    message: "",
    appToDelete: null as any,
  };

  showDbModal = false;
  config = {
    logs: {
      enabled: true,
      reportToCreator: false,
    },
    theme: "sandra",
    access: {
      remoteControl: true,
      networkBroadcast: false,
    },
    updates: {
      autoUpdate: true,
    },
  };

  apps: any[] = [];

  // Connections
  availableConnections: any[] = [];
  activeConnection: any = null;
  clientId: string = "";

  activeTabId$: Observable<string>;
  openTabs$: Observable<Tab[]>;
  rightSidebarOpen$: Observable<boolean>;
  leftSidebarOpen$: Observable<boolean>;
  currentTabId: string = "dashboard";

  isInspectorOpen = false;

  genericModal = { show: false, title: '', message: '' };


  constructor(
    public appState: AppStateService,
    private sdcService: SdcService,
    private desktopAppsService: DesktopAppsService,
    private downloadService: DownloadService, // Inyección del nuevo servicio
    private logger: LoggerService,
    private zone: NgZone,
    private sanitizer: DomSanitizer,
    private titleService: Title,
  ) {
    // ... existing constructor logic ...

    // Close splash screen
    // Esperamos 5 segundos antes de cerrar el splash y mostrar el main
    setTimeout(async () => {
      try {
        await invoke("close_splash");
        // console.log("Splash closed via Frontend Timer");
      } catch (err) {
        console.error("Error closing splash:", err);
      }
    }, 5000);


    this.activeTabId$ = this.appState.activeTabId$;
    this.openTabs$ = this.appState.openTabs$;
    this.rightSidebarOpen$ = this.appState.rightSidebarOpen$;
    this.leftSidebarOpen$ = this.appState.leftSidebarOpen$;

    this.rightSidebarOpen$.subscribe((val) => (this.isInspectorOpen = val));

    this.logger.initialize();

    // -- Dynamic Title Logic --
    this.activeTabId$.subscribe((id) => {
      this.currentTabId = id;
      this.updateTitle(id);
      // Aplicar reglas de sidebar al cambiar de pestaña
      setTimeout(() => this.checkSidebarResponsive(window.innerWidth), 0);

      // Si volvemos al dashboard, refrescar datos inmediatamente para no esperar 5 min
      if (id === "dashboard") {
        this.refreshStats();
      }
    });

    setInterval(() => {
      this.currentTime = new Date();
      this.updateDateTime();
    }, 1000);
    this.updateDateTime();
  }

  async ngOnInit() {


    this.loadApps(); // Load dynamic apps
    this.checkSidebarResponsive(window.innerWidth);
    this.refreshStats();
    // Modificado: Ejecutar solo si estamos en Dashboard y cada 5 minutos
    setInterval(() => {
      if (this.currentTabId === "dashboard") {
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
    await listen("connection-status", (event: any) => {
      // console.log("Global connection status updated:", event.payload);
      const s = event.payload as string;
      if (s === "connected") {
        this.wsStatus = "Conectado";
      } else if (s === "disconnected") {
        this.wsStatus = "Desconectado";
      } else if (s === "connecting") {
        this.wsStatus = "Reintentando";
      } else if (s === "error") {
        this.wsStatus = "Desconectado";
      }
      this.zone.run(() => {
        // Trigger UI update
      });
    });

    // Initialize Client ID and Connections
    this.clientId = await this.sdcService.getClientId();
    await this.loadConnections();

    // Subscribe to App Updates
    this.desktopAppsService.appsUpdated$.subscribe(() => {
      this.loadApps();
    });
  }

  async loadApps() {
    try {
      const dbApps = await this.desktopAppsService.getAllApps();
      this.apps = dbApps.map((a) => ({
        id: a.app_id, // Map app_id to id for component compatibility
        name: a.name,
        icon: a.icon,
        installed: a.is_installed,
        repo: a.repo,
        externalUrl: a.external_url,
        action: a.id === 1000 ? "toggleCP" : undefined, // Placeholder logic or remove action dep
        // Propagating full DB object for updates
        _dbId: a.id,
        _original: a,
        is_proxy_required: a.is_proxy_required, // Ensure this property is mapped!
      }));
    } catch (e) {
      console.error("Error loading apps", e);
    }
  }

  // ...

  async loadConnections() {
    try {
      this.availableConnections = await this.sdcService.getConnections();
      this.activeConnection =
        this.availableConnections.find((c) => c.is_connected) || null;

      // Verificar estado real si hay una conexión activa marcada
      if (this.activeConnection) {
        await this.verifyActiveConnection();
      } else {
        this.wsStatus = "Desconectado";
      }
    } catch (e) {
      console.error("Error loading connections", e);
    }
  }

  // Verificar estado del host (Ping/TCP Check) tal como en Configurar Conexión
  async verifyActiveConnection() {
    if (!this.activeConnection) return;

    try {
      const isUp = await invoke("verify_connection_status", {
        ip: this.activeConnection.ip_address,
        port: Number(this.activeConnection.port),
      });

      if (isUp) {
        // Si el host responde y estaba marcado como conectado
        this.wsStatus = "Conectado";
      } else {
        // Host no responde
        this.wsStatus = "Reintentando";
      }
    } catch (e) {
      console.error("Error verifying connection status", e);
      this.wsStatus = "Desconectado";
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
      this.showModal("Error", "Error al activar conexión: " + e);
    }
  }

  async disconnectConnection(conn: any) {
    if (!conn) return;
    try {
      await this.sdcService.disconnectFromServer(conn, this.clientId);
      this.activeConnection = null;
      this.wsStatus = "Desconectado"; // Optimistic update

      // Update the connection in the list to reflect disconnected state
      // (assuming getConnections reads from DB where flag is updated)
      await this.loadConnections();
    } catch (e) {
      console.error("Error disconnecting", e);
      this.showModal("Error", "Error al desconectar: " + e);
    }
  }

  // ... other methods ...

  openApp(app: any) {
    let rawUrl = "";

    // Lógica inteligente de URL:
    // 1. Si la App requiere Proxy -> Forzar sandra-app:// (incluso si es externa) para interceptar tráfico
    // 2. Si es Externa y NO requiere Proxy -> Usar URL directa (Navegador maneja)
    // 3. Si es Local -> Usar sandra-app:// estándar

    if (app.externalUrl && !app.is_proxy_required) {
      // Caso 2: Externa Directa
      rawUrl = app.externalUrl;
      console.log(
        `🌍 [External Nav] Direct (No Proxy) ${app.name} -> ${rawUrl}`,
      );
      this.logger.log("FETCH", `GET ${rawUrl} [200]`, "Navigation", app.id);
    } else if (app.externalUrl && app.is_proxy_required) {
      // Caso 1: Externa Proxied (Wrap en sandra-app)
      // Formato: sandra-app://localhost/external-proxy/{APP_ID}?target={URL}
      const target = encodeURIComponent(app.externalUrl);
      rawUrl = `sandra-app://localhost/external-proxy/${app.id}?target=${target}`;
      console.log(
        `🛡️ [Proxy Nav] Wrapping External ${app.name} -> ${rawUrl}`,
      );
    } else {
      // Caso 3: Local (Proxied o No, siempre usa sandra-app)
      rawUrl = `sandra-app://localhost/${app.id}/`;
      console.log(
        `🚀 [Local Nav] Opening ${app.name} via ${rawUrl} (Proxy Active: ${!!this.activeConnection})`,
      );
    }

    const safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(rawUrl);
    this.appState.addTab({
      id: app.id,
      name: app.name,
      icon: app.icon,
      url: safeUrl,
      isProxyRequired: app.is_proxy_required,
      isExternal: !app.externalUrl,
    });
  }

  // ... rest of class ...

  get statusColor(): string {
    switch (this.wsStatus) {
      case "Conectado":
        return "#66BB6A";
      case "Desconectado":
        return "#CFD8DC"; // Gray
      case "Reintentando":
        return "#FFA726";
      case "Suspendido":
        return "#EF5350";
      default:
        return "#CFD8DC";
    }
  }

  updateDateTime() {
    const now = this.currentTime;
    const months = [
      "ENE",
      "FEB",
      "MAR",
      "ABR",
      "MAY",
      "JUN",
      "JUL",
      "AGO",
      "SEP",
      "OCT",
      "NOV",
      "DIC",
    ];
    const day = now.getDate().toString().padStart(2, "0");
    const month = months[now.getMonth()];
    const year = now.getFullYear().toString().slice(-2);
    this.currentDateStr = `${day}${month}${year}`;
    this.currentTimeStr = now.toLocaleTimeString("es-ES", { hour12: false });
  }

  async initStatusListener() {
    await listen<{ status: string; attempt?: number }>(
      "ws-status-update",
      (event) => {
        this.zone.run(() => {
          const payload = event.payload;
          switch (payload.status) {
            case "Connected":
              this.wsStatus = "Conectado";
              this.attemptNumber = 0;
              break;
            case "Retrying":
              this.wsStatus = "Reintentando";
              this.attemptNumber = payload.attempt || 0;
              break;
            case "Suspended":
              this.wsStatus = "Suspendido";
              this.attemptNumber = 0;
              break;
            default:
              this.wsStatus = "Desconectado";
          }
        });
      },
    );
  }

  toggleLeftSidebar() {
    this.appState.toggleLeftSidebar();
  }
  toggleRightSidebar() {
    this.appState.toggleRightSidebar();
  }

  @HostListener("window:resize", ["$event"])
  onResize(event: any) {
    this.checkSidebarResponsive(window.innerWidth);
  }

  checkSidebarResponsive(width: number) {
    // Definir páginas estáticas donde el sidebar SI puede aparecer (sujeto a resolución)
    const staticPages = [
      "dashboard",
      "connections",
      "security",
      "monitor",
      "apps",
      "secure-viewer",
    ];

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

  switchToDashboard() {
    this.appState.setActiveTab("dashboard");
  }

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
    return (bytes / 1024 ** 3).toFixed(2) + " GB";
  }

  greet(event: SubmitEvent, name: string): void {
    event.preventDefault();
    invoke<string>("greet", { name }).then((text) => {
      this.greetingMessage = text;
    });
  }

  async loadNetwork() {
    try {
      this.networkInfo = await this.sdcService.getNetworkInfo();
    } catch (err) {
      console.error("Error network:", err);
    }
  }

  async reboot() {
    try {
      const response = await this.sdcService.requestRemoteReboot();
      console.log(response);
    } catch (err) {
      this.showModal("Error", "Error reboot: " + err);
    }
  }

  handleAppClick(app: DesktopApp) {
    if (app.action === "toggleCP") {
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
      this.installModal = {
        show: true,
        title: `Instalando ${app.name}`,
        message: "Descargando...",
        error: null,
        success: false,
      };
      try {
        await invoke("download_app_repo", {
          repoUrl: app.repo,
          folderName: app.id,
        });
        app.installed = true;

        // SYNC WITH DB
        if (app._original) {
          app._original.is_installed = true;
          await this.desktopAppsService.updateApp(app._original);
        }

        this.installModal.success = true;
        this.installModal.message = "Instalado correctamente.";
        setTimeout(() => this.closeModal(), 2000);
      } catch (err: any) {
        this.installModal.error =
          typeof err === "string" ? err : "Error desconocido";
      }
    }
  }

  closeModal() {
    this.installModal.show = false;
  }

  async updateApp(app: any) {
    this.installModal = {
      show: true,
      title: `Actualizando ${app.name}`,
      message: "Sincronizando...",
      error: null,
      success: false,
    };
    try {
      await invoke("update_app_repo", { folderName: app.id });
      this.installModal.success = true;
      this.installModal.message = "Actualizado correctamente.";
      setTimeout(() => this.closeModal(), 1500);
    } catch (err: any) {
      this.installModal.error =
        typeof err === "string" ? err : "Error al actualizar";
    }
  }

  async deleteApp(app: any) {
    this.confirmModal = {
      show: true,
      title: "Desinstalar",
      message: `¿Eliminar ${app.name}?`,
      appToDelete: app,
    };
  }

  cancelDelete() {
    this.confirmModal.show = false;
    this.confirmModal.appToDelete = null;
  }

  async confirmDelete() {
    const app = this.confirmModal.appToDelete;
    this.confirmModal.show = false;
    if (app) {
      this.installModal = {
        show: true,
        title: `Desinstalando ${app.name}`,
        message: "Eliminando...",
        error: null,
        success: false,
      };
      try {
        await invoke("delete_app_repo", { folderName: app.id });
        app.installed = false;

        // SYNC WITH DB
        if (app._original) {
          app._original.is_installed = false;
          await this.desktopAppsService.updateApp(app._original);
        }

        this.installModal.success = true;
        this.installModal.message = "Eliminado correctamente.";
        setTimeout(() => this.closeModal(), 1500);
      } catch (err: any) {
        this.installModal.error =
          typeof err === "string" ? err : "Error al eliminar";
      }
    }
  }

  // Unlock Tab State
  showUnlockTabModal = false;
  unlockTabPin = '';
  tabToUnlock: any = null;

  unlockTab(tab: any) {
    if (!tab.filePath && !tab.hiddenContent) {
      this.showModal("Error", "No se puede determinar la ruta del archivo original. Asegúrate de abrirlo desde el Historial.");
      return;
    }
    this.tabToUnlock = tab;
    this.unlockTabPin = '';
    this.showUnlockTabModal = true;
  }

  cancelTabUnlock() {
    this.showUnlockTabModal = false;
    this.tabToUnlock = null;
    this.unlockTabPin = '';
  }

  async submitTabUnlock() {
    if (!this.unlockTabPin || !this.tabToUnlock) return;
    this.showUnlockTabModal = false;

    try {
      let base64Data = '';

      // Opción A: Desbloqueo en Memoria (Recién abierto)
      if (this.tabToUnlock.hiddenContent) {
        // Validación simple de PIN (TODO: Mejorar seguridad en producción)
        if (this.unlockTabPin !== '1234') {
          throw "PIN Incorrecto";
        }
        base64Data = this.tabToUnlock.hiddenContent;
        this.tabToUnlock.hiddenContent = undefined; // Limpiar memoria
      }
      // Opción B: Desbloqueo desde Disco (Historial)
      else if (this.tabToUnlock.filePath) {
        base64Data = await invoke<string>('load_sse_document', {
          filePath: this.tabToUnlock.filePath,
          unlockPin: this.unlockTabPin
        });
      } else {
        throw "No se encontró contenido para desbloquear.";
      }

      // Success -> Update Tab Content
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);

      const dataUri = base64Data.startsWith('data:')
        ? base64Data
        : `data:application/pdf;base64,${base64Data}`;

      // Update Tab
      this.tabToUnlock.content = safeUrl;
      this.tabToUnlock.url = safeUrl;
      this.tabToUnlock.blobData = dataUri;
      this.tabToUnlock.isProtected = false; // Now it IS unlocked in view
      this.tabToUnlock.isLocked = false;

    } catch (e: any) {
      console.error(e);
      if (e && typeof e === 'string' && e.includes("PIN Incorrecto")) {
        this.showModal("Error de PIN", "El PIN es incorrecto.");
      } else {
        const msg = typeof e === 'string' ? e : (e.message || JSON.stringify(e));
        this.showModal("Error", "No se pudo desbloquear: " + msg);
      }
    } finally {
      this.tabToUnlock = null;
      this.unlockTabPin = '';
    }
  }



  showIpInfo() {
    if (this.networkInfo.length > 0) {
      this.showModal("Direcciones IP Detectadas", this.networkInfo.join("\n"));
    } else {
      this.showModal("Info", "No se detectaron direcciones IP.");
    }
  }

  showMacInfo() {
    if (this.stats && this.stats.mac_address) {
      this.showModal(
        "Identidad del Sistema (MAC/ID)",
        `${this.stats.mac_address}\n\nNota: Si no se detecta la MAC física, se muestra el Hostname.`,
      );
    } else {
      this.showModal("Info", "Información de Identidad no disponible.");
    }
  }

  // -- Restored Methods --

  // -- Iframe Communication Listeners --

  @HostListener("window:message", ["$event"])
  async onMessage(event: MessageEvent) {
    if (!event.data || !event.data.type) return;

    const { type, payload } = event.data;
    console.log(`📥 [Bridge] Mensaje recibido: ${type}`, payload?.fileName);

    switch (type) {
      case "DOWNLOAD_PDF":
        await this.handleIframeDownload(payload.fileName, payload.data);
        break;

      case "OPEN_PDF":
      case "OPEN_PDF_SECURITY":
        await this.handleIframeOpen(payload.fileName, payload.data, false);
        break;

      case "DOWNLOAD_SSE":
        await this.handleSSEDownload(payload.fileName, payload.data);
        break;

      case "OPEN_SSE":
      case "OPEN_SSE_SECURITY":
        await this.handleIframeOpen(payload.fileName, payload.data, true, payload.isSaved || false);
        break;

      case "OPEN_PDF_HACK":
        await this.handlePdfHack(payload.fileName, payload.data, payload.meta);
        break;

      default:
        break;
    }
  }

  async handleIframeOpen(fileName: string, dataUri: string, isProtected: boolean, isSaved: boolean = false) {
    // --- Secure Viewer Logic (Intercept Protected Docs) ---
    if (isProtected) {
      try {
        const base64 = dataUri.includes('base64,') ? dataUri.split('base64,')[1] : dataUri;
        // Call Rust to split PDF (Cover vs Content)
        const res = await invoke<{ cover: string, content: string }>('prepare_sse_preview', { pdfBase64: base64 });

        // Convert Cover to BlobUrl for View
        const byteCharacters = atob(res.cover);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);

        const tabId = 'doc-view-' + Date.now();

        this.appState.addTab({
          id: tabId,
          name: fileName.replace(/\.pdf$/i, '.sse'),
          icon: 'fas fa-file-shield',
          type: 'pdf-viewer',
          content: safeUrl,        // Visible: Cover Page (QR)
          url: safeUrl,
          blobData: dataUri,       // Save/History: Original Full PDF
          originalName: fileName,
          isProtected: true,
          isSavedToHistory: isSaved,
          showToolbar: true,
          zoomLevel: 1.0,
          isLocked: true,          // Flag: Locked State
          hiddenContent: res.content // Unlock Data: Content Pages
        });

        // Show unlock modal immediately if desired, or let user click button.
        // User requested: "queda habilitado el boton desbloquear". So we just open the tab locked.
        return;

      } catch (e) {
        console.error("Error creating secure preview, falling back to standard view:", e);
        // Fallthrough to standard logic below
      }
    }

    // --- Standard Logic (Original) ---
    try {
      const res = await fetch(dataUri);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);

      const tabId = 'doc-view-' + Date.now();

      this.appState.addTab({
        id: tabId,
        name: isProtected ? fileName.replace(/\.pdf$/i, '.sse') : fileName,
        icon: isProtected ? 'fas fa-file-shield' : 'fas fa-file-pdf',
        type: 'pdf-viewer',
        content: safeUrl,
        url: safeUrl,
        blobData: dataUri,       // Save raw data for later actions (Save/History)
        originalName: fileName,  // Save name
        isProtected: isProtected, // Pass protection status
        isSavedToHistory: isSaved, // Control History Button
        showToolbar: true,        // ENABLE Toolbar for API calls
        zoomLevel: 1.0           // Init Zoom
      });
    } catch (e) {
      console.error("Error opening PDF tab:", e);
    }
  }

  async handleSSEDownload(fileName: string, dataUri: string) {
    try {
      const base64 = dataUri.split(',')[1];
      const finalName = fileName.replace(/\.pdf$/i, '') + '.sse';

      const { save } = await import('@tauri-apps/plugin-dialog');
      const path = await save({
        defaultPath: finalName,
        filters: [{
          name: 'Bunker Secure Document',
          extensions: ['sse']
        }]
      });

      if (!path) return; // Cancelled

      await invoke('save_protected_pdf', {
        pdfBase64: base64,
        filePath: path,
        pin: '1234' // Default or Todo: Ask User
      });

      await invoke('add_document_history', { fileName: finalName, filePath: path });
      this.showModal("Descarga Completada", `Archivo protegido guardado en: ${path}`);

    } catch (e: any) {
      console.error("Error saving SSE:", e);
      const msg = typeof e === 'string' ? e : (e.message || JSON.stringify(e));
      this.showModal("Error de Descarga", msg);
    }
  }

  async handlePdfHack(fileName: string, dataUri: string, meta: any) {
    console.log("Hacking PDF via API...", meta);
    setTimeout(() => {
      this.handleIframeOpen("HACKED_" + fileName, dataUri, true);
    }, 500);
  }

  async savePdfToHistory(tab: Tab) {
    if (!tab.blobData || !tab.originalName) {
      this.showModal("Error", "Este documento no tiene datos recuperables.");
      return;
    }
    try {
      const { tempDir, join } = await import('@tauri-apps/api/path');
      const tempPath = await tempDir();

      const base64 = tab.blobData.split(',')[1];

      let fullPath = '';
      let savedName = tab.originalName;

      if (tab.isProtected) {
        // SSE Conversion Case
        // Change extension to .sse
        savedName = tab.originalName.replace(/\.pdf$/i, '.sse');
        const tempName = `cached_${Date.now()}_${savedName}`;
        fullPath = await join(tempPath, tempName);

        // Use Rust command to save as SSE (Encrypted)
        await invoke('save_protected_pdf', {
          pdfBase64: base64,
          filePath: fullPath,
          pin: '1234'
        });

      } else {
        // Normal PDF Case
        const tempName = `cached_${Date.now()}_${tab.originalName}`;
        fullPath = await join(tempPath, tempName);

        const binaryData = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const { writeFile } = await import('@tauri-apps/plugin-fs');
        await writeFile(fullPath, binaryData);
      }

      await invoke('add_document_history', { fileName: savedName, filePath: fullPath });

      // HIDE HISTORY BUTTON
      tab.isSavedToHistory = true;

      this.showModal("Historial Actualizado", `El documento se ha guardado correctamente en el historial.`);
    } catch (e: any) {
      console.error("History save error:", e);
      const msg = typeof e === 'string' ? e : (e.message || JSON.stringify(e));
      this.showModal("Error de Guardado", msg);
    }
  }

  // Generic Modal Logic
  showModal(title: string, message: string) {
    this.genericModal = { show: true, title, message };
  }

  closeGenericModal() {
    this.genericModal = { show: false, title: '', message: '' };
  }

  async downloadPdfFromTab(tab: Tab) {
    if (!tab.blobData || !tab.originalName) return;
    // If Protected (SSE), forceSSE = true. Else false.
    const forceSSE = !!tab.isProtected;
    await this.downloadService.handleDownload(tab.originalName, tab.blobData, "1234", forceSSE);
  }

  zoomPdf(tab: Tab, delta: number) {
    if (!tab.zoomLevel) tab.zoomLevel = 1.0;
    const newZoom = Math.min(Math.max(tab.zoomLevel + delta, 0.5), 3.0); // Limit 0.5x to 3.0x
    tab.zoomLevel = parseFloat(newZoom.toFixed(1));
  }

  async printPdf(tab: Tab) {
    if (!tab.blobData) {
      this.showModal("Aviso", "No hay datos para imprimir.");
      return;
    }

    try {
      console.log("🖨️ Enviando documento a cola de impresión nativa...");
      const base64Clean = tab.blobData.split(',')[1];

      // Invoke Rust Command
      // Signature: fn print_pdf_direct(pdf_base64: String, job_title: Option<String>)
      await invoke('print_pdf_direct', {
        pdfBase64: base64Clean,
        jobTitle: tab.name || "SandraDocument.pdf"
      });

      this.showModal("Impresión Enviada", "El documento ha sido enviado a la impresora predeterminada del sistema.");

    } catch (e) {
      console.error("Print Error:", e);
      this.showModal("Error de Impresión", "" + e);
    }
  }


  async handleIframeDownload(fileName: string, dataUri: string) {
    try {
      console.log("📥 [Bridge -> DownloadService] Delegando descarga:", fileName);
      const success = await this.downloadService.handleDownload(fileName, dataUri, "1234", false);

      if (success) {
        console.log("✅ Descarga completada correctamente.");
      } else {
        console.warn("⚠️ Descarga cancelada o fallida.");
      }
    } catch (e) {
      console.error("❌ Error en puente de descarga:", e);
      this.showModal("Error", "Error al guardar archivo protegido: " + e);
    }
  }

  @HostListener("window:keydown", ["$event"])
  async handleKeyboardEvent(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
      event.preventDefault();

      const contextId = [
        "dashboard",
        "connections",
        "apps",
        "security",
        "monitor",
        "system",
        "secure-viewer",
      ].includes(this.currentTabId)
        ? "App.SDC"
        : this.currentTabId;

      if (!this.isInspectorOpen) {
        this.toggleRightSidebar();
      } else {
        if (this.logger.hasLogs(contextId)) {
          if (
            confirm(
              "Hay logs en el inspector para esta aplicación. ¿Desea guardarlos antes de cerrar?",
            )
          ) {
            await this.logger.saveAllLogs(contextId);
          }
        }
        this.toggleRightSidebar();
      }
    }
  }

  showSaveLogModal = false;
  tabIdToClose: string | null = null;

  async closeTab(tabId: string, evt: Event) {
    evt.stopPropagation();
    evt.preventDefault();

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
        this.logger.clearLogs(this.tabIdToClose);
      }
      this.appState.closeTab(this.tabIdToClose);
    }
    this.showSaveLogModal = false;
    this.tabIdToClose = null;
  }

  updateTitle(tabId: string) {
    if (tabId === "dashboard") {
      this.titleService.setTitle("Sandra Desktop Container");
      return;
    }
    const tabs = this.appState.getTabsSnapshot();
    const activeTab = tabs.find((t) => t.id === tabId);
    if (activeTab) {
      this.titleService.setTitle(`${activeTab.name} - Sandra DC`);
    } else {
      const staticName = tabId.charAt(0).toUpperCase() + tabId.slice(1);
      this.titleService.setTitle(`${staticName} - Sandra DC`);
    }
  }

  reloadActiveIframe() {
    if (this.currentTabId === "dashboard") return;
    const iframeId = "iframe-" + this.currentTabId;
    const iframe = document.getElementById(iframeId) as HTMLIFrameElement;

    if (iframe) {
      console.log(`Reloading iframe: ${iframeId}`);
      const currentSrc = iframe.src;
      iframe.src = currentSrc;
    } else {
      console.warn(`Iframe not found for reloading: ${iframeId}`);
    }
  }

  onIframeLoad(tabId: string) {
    console.log(`[Iframe Loaded] Sending context to ${tabId}`);
    this.sendContextToIframe(tabId);
  }

  sendContextToIframe(tabId: string) {
    const iframeId = "iframe-" + tabId;
    const iframe = document.getElementById(iframeId) as HTMLIFrameElement;

    if (iframe && iframe.contentWindow) {
      const contextPayload = {
        system: this.stats,
        network: { ips: this.networkInfo },
        config: { clientId: this.clientId },
        timestamp: new Date().toISOString(),
      };
      // console.log(`[PostMessage] Sending NETWORK_CONTEXT to ${tabId}`, contextPayload);
      iframe.contentWindow.postMessage(
        {
          type: "NETWORK_CONTEXT",
          payload: contextPayload,
        },
        "*",
      );
    }
  }

  saveConfig() {
    console.log("Config guardada:", this.config);
    this.showControlPanel = false;
  }
}
