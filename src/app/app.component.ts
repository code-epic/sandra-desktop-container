import {
  Component,
  OnInit,
  NgZone,
  HostListener,
  DoCheck,
  ViewChild,
} from "@angular/core";
import { CommonModule, NgIf } from "@angular/common";
import { FormsModule } from "@angular/forms";
import {
  DomSanitizer,
  SafeResourceUrl,
  Title,
} from "@angular/platform-browser";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Webview } from "@tauri-apps/api/webview";
import { LogicalSize, LogicalPosition } from "@tauri-apps/api/dpi";
import { SecurityService } from "./core/services/security.service";
import { SdcService } from "./core/services/sdc.service";
import { LoggerService } from "./core/services/logger.service";
import { SystemStats } from "./core/models/telemetry.model";
import {
  AppStateService,
  Tab,
  BackgroundTask,
} from "./core/services/app-state.service";
import { DownloadService } from "./core/services/download.service";
import { FileService } from "./core/services/file.service";
import { Observable, Subject } from "rxjs";
import { debounceTime } from "rxjs/operators";
import { SnapService, SnapData } from "./core/services/snap.service";
import { ISandraJwtPayload } from "./core/models/security.model";
import { UtilsService } from "./core/services/utils.service";
// import { PDFDocument, rgb, degrees } from 'pdf-lib'; // REMOVED: Now handled in DownloadService/ChildApp

import { listen, UnlistenFn } from "@tauri-apps/api/event";
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
import { ProyectosComponent } from "./pages/proyectos/proyectos.component";
import { SecureViewerComponent } from "./components/secure-viewer/secure-viewer.component";
import { BackgroundProgressComponent } from "./components/background-progress/background-progress.component";
import { HttpProgressComponent } from "./components/background-progress/http-progress.component";
import { SetupWizardComponent } from "./components/setup-wizard/setup-wizard.component";
import { LoginModalComponent } from "./components/login-modal/login-modal.component";
import { PerformanceService } from "./core/services/performance.service";
import { UpdateService } from "./core/services/update.service";
import { ModalService } from "./core/services/modal.service";

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
    NgIf,
    FormsModule,
    SidebarComponent,
    DashboardComponent,
    ConnectionsComponente,
    SecurityComponent,
    MonitorComponent, // Monitor de sistema seguro
    StorageComponent,
    InspectorComponent,
    ConfigComponent,
    AppsComponent,
    ChatComponent,
    ProyectosComponent,
    SecureViewerComponent,
    BackgroundProgressComponent,
    HttpProgressComponent,
    SetupWizardComponent,
    LoginModalComponent,
  ],
  templateUrl: "./app.component.html",
  styleUrls: ["./app.component.css"],
})
export class AppComponent implements OnInit, DoCheck {
  @ViewChild("chatComponent") chatComponent?: ChatComponent;
  @ViewChild("configComponent") configComponent?: ConfigComponent;
  stats: SystemStats | null = null;
  greetingMessage = "";
  networkInfo: string[] = [];

  currentTime = new Date();
  currentDateStr = "";
  currentTimeStr = "";
  showControlPanel = false;

  showLoginModal = false;
  loginIpAddress = "";
  loginPort = 22;

  tasks = [
    { title: "Sincronización Nodos", time: "10:42 AM", status: "active" },
    { title: "Respaldo Diario", time: "02:00 PM", status: "pending" },
    { title: "Actualización Certs", time: "04:30 PM", status: "pending" },
  ];

  wsStatus: ConnectionStatus = "Desconectado";
  machineNameMain: string = "Sandra";
  machineNameSuffix: string = "DC";
  machineArea: string = "";
  machineDescription: string = "";
  showMachinePopover: boolean = false;

  // --- JWT SESSION STATE ---
  sessionUsername: string = "";
  jwtNombre: string = "";
  jwtCargo: string = "";
  jwtDescripcion: string = "";
  sessionTimeRemaining: string = "";
  sessionSecondsLeft: number = 0;
  private jwtTimerInterval: any;
  private jwtWarningShown: boolean = false;

  attemptNumber: number = 0;
  pendingTicketsCount: number = 0;
  private csvSearchSubject = new Subject<Tab>();
  private txtSearchSubject = new Subject<Tab>();
  private backgroundTaskUnlisten?: UnlistenFn;
  private resizeObserver?: ResizeObserver;
  private activePlaceholderId: string | null = null;
  private transitionInterval: any;

  installModal = {
    show: false,
    title: "",
    message: "",
    error: null as string | null,
    success: false,
  };

  // --- VIEWER SEARCH STATE ---
  csvSearchQuery = "";
  showCsvSearch = false;
  txtSearchQuery = "";
  showTxtSearch = false;

  confirmModal = {
    show: false,
    title: "",
    message: "",
    appName: "",
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
      enableJwtSession: false,
      jwtStorage: "localStorage",
      jwtVariableName: "token",
    },
    updates: {
      autoUpdate: true,
    },
  };

  apps: any[] = [];

  // Connections
  availableConnections: any[] = [];
  activeConnection: any = null;
  isChangingConnection: boolean = false;
  clientId: string = "";
  activeNativeWebviews: Record<string, Webview> = {};

  activeTabId$: Observable<string>;
  openTabs$: Observable<Tab[]>;
  chatVisible$: Observable<boolean>;
  rightSidebarOpen$: Observable<boolean>;
  leftSidebarOpen$: Observable<boolean>;
  currentTabId: string = "dashboard";
  isChatVisible = false;
  isChatOpen = false;
  lastOverlayState = false;

  isInspectorOpen = false;

  genericModal = {
    show: false,
    title: "",
    message: "",
    type: "info" as "success" | "error" | "info" | "warning",
    infoIcon: "fa-info-circle",
  };
  exitModal = { show: false, closing: false };
  isExitConfirmed = false;

  globalLoading$!: Observable<{ isLoading: boolean; message: string }>;
  viewerLoading$!: Observable<boolean>;
  isViewerLoading = false;

  // Snap Message Global State
  snapMessage: SnapData | null = null;
  showSnap: boolean = false;

  // Track MessagePorts for Secure Authorizations
  authPorts = new Map<string, MessagePort>();

  questionModal: import("./core/services/modal.service").QuestionModalState = {
    show: false,
    title: "",
    message: "",
    confirmText: "Aceptar",
    cancelText: "Cancelar",
    onConfirm: () => {},
    onCancel: () => {},
  };

  showJwtSetupModal = false;

  // ModalService takes care of the state; AppComponent just binds to it
  closeGenericModal() {
    this.modalService.closeGenericModal();
  }

  constructor(
    public appState: AppStateService,
    private sdcService: SdcService,
    private desktopAppsService: DesktopAppsService,
    private downloadService: DownloadService, // Inyección del nuevo servicio
    private logger: LoggerService,
    private zone: NgZone,
    private sanitizer: DomSanitizer,
    private titleService: Title,
    private snapService: SnapService,
    private fileService: FileService,
    public securityService: SecurityService,
    public utils: UtilsService,
    private performance: PerformanceService,
    private updateService: UpdateService,
    public modalService: ModalService,
  ) {
    // ... existing constructor logic ...
    this.performance.initialize();
    this.loadConfig(); // Asegurar que cargamos config antes de aplicar tema
    this.applyTheme();

    // Close splash screen
    // Esperamos 5 segundos antes de cerrar el splash y mostrar el main
    this.initApplication();

    this.activeTabId$ = this.appState.activeTabId$;
    this.openTabs$ = this.appState.openTabs$;
    this.chatVisible$ = this.appState.chatVisible$;
    this.globalLoading$ = this.appState.globalLoading$;
    this.rightSidebarOpen$ = this.appState.rightSidebarOpen$;
    this.leftSidebarOpen$ = this.appState.leftSidebarOpen$;
    this.viewerLoading$ = this.appState.viewerLoading$;

    this.modalService.genericModal$.subscribe((state) => {
      this.zone.run(() => {
        this.genericModal = {
          show: state.show,
          title: state.title,
          message: state.message,
          type: state.type as "success" | "error" | "info",
          infoIcon: state.infoIcon || "fa-info-circle",
        };
      });
    });

    this.modalService.questionModal$.subscribe((state) => {
      this.zone.run(() => {
        this.questionModal = state;
      });
    });

    this.modalService.closeAllOverlays$.subscribe(() => {
      this.zone.run(() => {
        this.showControlPanel = false;
        this.showLoginModal = false;
        this.showJwtSetupModal = false;
      });
    });

    this.viewerLoading$.subscribe((val) => (this.isViewerLoading = val));

    this.rightSidebarOpen$.subscribe((val) => {
      this.isInspectorOpen = val;
      this.syncWebviewDuringTransition();
    });
    this.leftSidebarOpen$.subscribe((val) => {
      this.syncWebviewDuringTransition();
    });
    this.chatVisible$.subscribe((val) => {
      this.isChatVisible = val;
      setTimeout(() => this.syncNativeWebviews(), 50);
    });

    this.logger.initialize();

    // -- Dynamic Title Logic --
    this.activeTabId$.subscribe((id) => {
      this.currentTabId = id;
      this.updateTitle(id);
      // Aplicar reglas de sidebar al cambiar de pestaña
      setTimeout(() => this.checkSidebarResponsive(window.innerWidth), 0);

      // Sincronizar Webviews nativos al cambiar de pestaña
      setTimeout(() => this.syncNativeWebviews(), 50);

      // Si volvemos al dashboard, refrescar datos inmediatamente para no esperar 5 min
      if (id === "dashboard") {
        this.refreshStats();
      }
    });

    // --- Search Optimization Logic ---
    this.csvSearchSubject.pipe(debounceTime(400)).subscribe((tab) => {
      this.executeCsvSearch(tab);
    });
    this.txtSearchSubject.pipe(debounceTime(400)).subscribe((tab) => {
      this.executeTxtSearch(tab);
    });

    setInterval(() => {
      this.currentTime = new Date();
      this.updateDateTime();
    }, 1000);
    this.updateDateTime();

    // -- Global Snap Message Listener --
    this.snapService.snap$.subscribe((data: SnapData) => {
      this.zone.run(() => {
        this.snapMessage = data;
        this.showSnap = true;
        setTimeout(() => {
          this.showSnap = false;
        }, 1200);
      });
    });
  }

  async loadPendingTicketsCount() {
    try {
      const tickets: any[] = await invoke("get_authorization_tickets", {
        userLogin: this.securityService.getCurrentUserLogin(),
      });
      this.pendingTicketsCount = tickets.filter(
        (t) => t.status === "pendiente",
      ).length;
    } catch (e) {
      console.warn("Error al cargar tickets pendientes:", e);
    }
  }

  async ngOnInit() {
    this.loadConfig();
    this.loadApps(); // Load dynamic apps
    this.setupBackgroundTaskListener();
    this.checkSidebarResponsive(window.innerWidth);
    this.refreshStats();
    this.loadPendingTicketsCount();
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

    this.startJwtSessionTimer();

    // Global Connection Status Listener
    await listen("connection-status", (event: any) => {
      this.zone.run(async () => {
        const s = event.payload as string;
        if (s === "connected") {
          this.wsStatus = "Conectado";
          this.showControlPanel = false; // Ocultar configuración tras conectar con éxito
          this.checkAndPromptJwt();
        } else if (s === "disconnected") {
          this.wsStatus = "Desconectado";
          if (!this.isChangingConnection) {
            await this.performLocalLogout();
          }
        } else if (s === "connecting") {
          this.wsStatus = "Reintentando";
        } else if (s === "error") {
          this.wsStatus = "Desconectado";
          if (!this.isChangingConnection) {
            await this.performLocalLogout();
          }
        }
      });
    });

    // HSF (High Security) Authorization Event
    await listen("hsf", async (event: any) => {
      this.zone.run(async () => {
        try {
          const msgData = event.payload;
          const rawAuthId = msgData.message; // authId enviado en message
          const authId = (rawAuthId || "").toLowerCase();
          const key = msgData.from; // key enviada en from

          // console.log(`🛡️ [Sec] Intento de autorización HSF para ${authId}`);

          const decryptedData = await invoke<string>(
            "process_hsf_authorization",
            {
              authId: rawAuthId, // Enviar el original a Rust por si acaso la DB es case-sensitive
              key,
              userLogin: this.securityService.getCurrentUserLogin(),
            },
          );

          this.pendingTicketsCount = Math.max(0, this.pendingTicketsCount - 1);
          // this.snapService.show(`Seguridad: Ticket #${rawAuthId} procesado con éxito`, undefined as any, "success", "fa-shield-check");

          // Notificar a la app hija si guardamos su puerto
          const port = this.authPorts.get(authId);
          // console.log(
          //   `🔌 [Sec] Buscando puerto para ${authId}:`,
          //   port ? "ENCONTRADO" : "NO ENCONTRADO",
          // );

          if (port) {
            // console.log(
            //   `📤 [Sec] Enviando mensaje de aprobación a la app hija para ${authId}`,
            // );
            port.postMessage({
              type: "AUTORIZACION_APROBADA",
              authId: rawAuthId,
              data: decryptedData,
            });
            this.authPorts.delete(authId);
          }
        } catch (e: any) {
          console.error("Error procesando autorización HSF:", e);
          this.snapService.show(
            "Fallo en Desencriptación",
            undefined as any,
            "error",
          );
        }
      });
    });

    // Initialize Connections (Client ID and Startup logic handled in initApplication)
    // Removed redundant loadConnections here to avoid race conditions with splash flow.

    // Refresh Monitor/Tickets Global Event
    await listen("refresh-monitor-data", async () => {
      this.zone.run(() => {
        this.loadPendingTicketsCount();
      });
    });

    // Subscribe to App Updates
    this.desktopAppsService.appsUpdated$.subscribe(() => {
      this.loadApps();
    });

    // Intercept Window Close
    const win = getCurrentWindow();
    win.onCloseRequested(async (event) => {
      if (this.isExitConfirmed) {
        // Si ya confirmamos la salida, dejamos que el evento proceda
        return;
      }

      event.preventDefault();
      this.zone.run(() => {
        this.handleExitRequest();
      });
    });
  }

  getJwtToken(): string | null {
    // Si la sesión JWT está deshabilitada globalmente y no hay un override de fuerza, devolvemos null
    // Pero si hay un token en el storage, es mejor devolverlo para mantener la UI sincronizada
    const storage =
      this.config.access.jwtStorage === "sessionStorage"
        ? sessionStorage
        : localStorage;
    const token = storage.getItem(this.config.access.jwtVariableName);

    if (token) {
      // Validar expiración del JWT (Pattern: decode and check 'exp')
      try {
        const payload = this.utils.decodeJwt(token);
        if (payload && payload.exp) {
          const now = Math.floor(Date.now() / 1000);
          if (payload.exp < now) {
            // console.warn(
            //   "🔐 [System] Token JWT expirado detectado. Limpiando...",
            // );
            storage.removeItem(this.config.access.jwtVariableName);
            return null;
          }
        }
        // Si el token es válido pero la bandera está apagada, la sincronizamos (Auto-Heal)
        if (!this.config.access.enableJwtSession) {
          this.config.access.enableJwtSession = true;
        }
        return token;
      } catch (e) {
        return null;
      }
    }

    return null;
  }

  loginConnections: any[] = [];
  requireJwtLogin: boolean = true;
  showConnectionSelectorInModal: boolean = false;

  async promptConnectionSelection(event?: MouseEvent) {
    if (event) {
      event.stopPropagation();
    }
    this.availableConnections = await this.sdcService.getConnections();
    this.zone.run(() => {
      this.loginConnections = this.availableConnections;
      this.requireJwtLogin = this.config.access.enableJwtSession;
      this.showConnectionSelectorInModal = true;
      this.showLoginModal = true;
    });
  }

  async checkAndPromptJwt(
    force: boolean = false,
    startWithLogin: boolean = false,
  ) {
    // console.log(
    //   "🔍 [System] checkAndPromptJwt llamado. Force:",
    //   force,
    //   "ActiveConn:",
    //   !!this.activeConnection,
    //   "JWT Enabled:",
    //   this.config.access.enableJwtSession,
    // );

    if (!this.activeConnection) {
      try {
        this.availableConnections = await this.sdcService.getConnections();
        this.activeConnection =
          this.availableConnections.find((c) => c.is_connected) || null;

        if (!this.activeConnection && this.availableConnections.length > 0) {
          this.activeConnection = this.availableConnections[0];
        }
      } catch (e) {
        console.error(
          "❌ [System] Error al cargar conexiones en checkAndPromptJwt:",
          e,
        );
      }
    }

    if (!this.activeConnection && this.availableConnections.length === 0) {
      this.zone.run(() => {
        this.showControlPanel = true;
        const safeEvent = { clientX: window.innerWidth / 2, clientY: 50 };
        this.snapService.show(
          "Configure una conexión primero",
          safeEvent as any,
          "error",
          "fa-network-wired",
        );
      });
      return;
    }

    const token = this.getJwtToken();

    // Si forzamos (clic manual) O si está habilitado y falta el token real
    if (force || (this.config.access.enableJwtSession && !token)) {
      if (this.showLoginModal && !force) {
        return;
      }
      // console.log("🔓 [System] ACTIVANDO showLoginModal = true");
      this.zone.run(() => {
        this.showControlPanel = false; // Cerramos el panel para ver el login claramente
        this.loginConnections = this.availableConnections;
        this.showConnectionSelectorInModal = !startWithLogin;
        this.requireJwtLogin = true;
        this.loginIpAddress = this.activeConnection
          ? this.activeConnection.ip_address || "localhost"
          : "localhost";
        this.loginPort = this.activeConnection
          ? Number(this.activeConnection.port) || 443
          : 443;

        if (this.showLoginModal) {
          // Si la modal ya está abierta, no la destruimos/recreamos para evitar el parpadeo de recarga
          return;
        }

        // Forzar ciclo de detección de cambios
        this.showLoginModal = false;
        setTimeout(() => {
          this.zone.run(() => {
            this.showLoginModal = true;
            // console.log("✅ [System] showLoginModal es ahora TRUE");
          });
        }, 10);
      });
    } else {
      // Sincronización silenciosa si ya hay token en storage
      if (
        token &&
        this.activeConnection &&
        (!this.activeConnection.jwt || this.activeConnection.jwt !== token)
      ) {
        // console.log(
        //   "🔄 [System] Sincronizando JWT existente a la conexión activa.",
        // );
        this.activeConnection.jwt = token;
      }
    }
  }

  confirmJwtSetup() {
    this.config.access.enableJwtSession = true;
    this.saveConfig(true); // Silent save
    this.showJwtSetupModal = false;
    this.checkAndPromptJwt();
    const safeEvent = { clientX: window.innerWidth / 2, clientY: 50 };
    this.snapService.show("Seguridad JWT Configurada", safeEvent as any);
  }

  handleLoginSuccess(token: string) {
    // console.log(
    //   "JWT Login completado. Token almacenado:",
    //   token.substring(0, 10) + "...",
    // );
    this.showLoginModal = false;

    // 1. Sincronizar Preferencias y Estado Global
    this.config.access.enableJwtSession = true;
    this.saveConfig(true);

    // 2. Sincronizar Identidad en la Conexión Activa
    if (this.activeConnection) {
      this.activeConnection.jwt = token; // Sincronizar token en objeto para servicios backend
      try {
        const payload: ISandraJwtPayload = this.utils.decodeJwt(token);
        if (payload?.Usuario) {
          this.activeConnection.username = payload.Usuario.usuario;
          this.activeConnection.profile = payload.Usuario.Perfil;
          // console.log(
          //   "✅ [App] Sesión sincronizada para:",
          //   this.activeConnection.username,
          // );
        }
      } catch (e) {
        console.warn(
          "[App] Error decodificando payload para sincronización:",
          e,
        );
      }

      // Persistir objeto de conexión actualizado
      localStorage.setItem(
        "active_connection",
        JSON.stringify(this.activeConnection),
      );

      // 3. Iniciar servicios dependientes de identidad
      this.securityService.startMailboxSync(
        this.activeConnection,
        this.activeConnection.profile || { usuario: "root", sistema: "admin" },
      );
    }

    // 4. Forzar refresco de UI (Candados en Sidebar)
    setTimeout(() => {
      // Esto asegura que getJwtToken() sea re-evaluado en el siguiente ciclo
      console.log("🔄 [App] Forzando refresco de UI post-login...");
    }, 100);

    // 5. Si había una redirección pendiente
    if (this.pendingNavTab) {
      this.appState.setActiveTab(this.pendingNavTab);
      this.pendingNavTab = null;
    }

    // 6. Si había una aplicación pendiente de abrir
    if (this.pendingAppToOpen) {
      this.openApp(this.pendingAppToOpen);
      this.pendingAppToOpen = null;
    }
  }

  pendingNavTab: string | null = null;
  pendingAppToOpen: any = null;

  handleNavigationRequest(tabId: string) {
    const protectedTabs = ["security", "monitor", "proyectos", "secure-viewer"];

    if (protectedTabs.includes(tabId)) {
      // 1. Verificar Conexión Real (WSS)
      if (!this.activeConnection || this.wsStatus !== "Conectado") {
        this.showModal(
          "Sin Conexión Activa",
          "El acceso a " +
            tabId.toUpperCase() +
            " requiere una conexión WebSocket establecida y estable con Sandra Server.",
        );
        return;
      }

      // 2. Verificar si la Sesión JWT está habilitada o forzar login si intentan entrar
      if (!this.config.access.enableJwtSession) {
        console.log(
          "🔒 [System] Sesión JWT deshabilitada, forzando login para acceso a zona protegida.",
        );
        this.pendingNavTab = tabId;
        this.checkAndPromptJwt(true);
        return;
      }

      // 3. Validación Robusta de JWT (Token real vs placeholder)
      const storage =
        this.config.access.jwtStorage === "sessionStorage"
          ? sessionStorage
          : localStorage;
      const token = storage.getItem(this.config.access.jwtVariableName);

      const isRealJwt = (t: any) => t && t.length > 20 && t.includes(".");
      const connectionHasJwt = isRealJwt(this.activeConnection.jwt);
      const storageHasJwt = isRealJwt(token);

      if (!storageHasJwt || !connectionHasJwt) {
        // Si no hay token válido, forzar login
        this.pendingNavTab = tabId;
        this.checkAndPromptJwt(true, false);

        const safeEvent = { clientX: window.innerWidth / 2, clientY: 50 };
        this.snapService.show("Autenticación Requerida", safeEvent as any);
        return;
      }
    }

    // Si todo es correcto o no es zona protegida
    this.appState.setActiveTab(tabId);
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
        is_external_browser: a.is_external_browser, // New Free Browser Mode
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
        // El Host responde (TCP), ahora verificar si el WebSocket está REALMENTE enlazado
        const realWsStatus = await invoke<string>("get_ws_status");

        if (realWsStatus === "connected") {
          this.wsStatus = "Conectado";
        } else if (realWsStatus === "connecting") {
          this.wsStatus = "Reintentando";
        } else {
          this.wsStatus = "Desconectado";
          await this.performLocalLogout();
        }
      } else {
        // Host no responde (Servidor apagado o inaccesible)
        this.wsStatus = "Desconectado";
        await this.performLocalLogout();
      }
    } catch (e) {
      console.error("Error verifying connection status", e);
      this.wsStatus = "Desconectado";
      await this.performLocalLogout();
    }
  }

  async activateConnectionGlobal(conn: any) {
    if (this.activeConnection && this.activeConnection.id === conn.id) {
      // Si ya está activa y pulsamos, forzamos el prompt de login para permitir cambiar de usuario o re-autenticar
      this.checkAndPromptJwt(true);
      return;
    }

    this.isChangingConnection = true;
    try {
      if (this.activeConnection) {
        await this.performLocalLogout();
      }

      // Deactivate previous if any? connect_to_server handles this in DB.
      // We invoke connect_to_server which sets is_connected=1 and starts WSS.

      // Optimistic UI update
      this.activeConnection = conn;
      localStorage.setItem("active_connection", JSON.stringify(conn));

      await this.sdcService.connectToServer(conn, this.clientId);
      // Refresh list to sync is_connected flags from DB
      await this.loadConnections();

      // Forzar el prompt de login tras una conexión manual exitosa
      this.checkAndPromptJwt(true);
    } catch (e) {
      console.error("Error activating connection", e);
      this.showModal("Error", "Error al activar conexión: " + e);
    } finally {
      this.isChangingConnection = false;
    }
  }

  async disconnectConnection(conn: any, stayInConfig: boolean = false) {
    if (!conn) {
      if (stayInConfig) this.showControlPanel = true;
      return;
    }

    const performDisconnect = async () => {
      try {
        await this.sdcService.disconnectFromServer(conn, this.clientId);
        await this.performLocalLogout();
        await this.loadConnections();
        const safeEvent = { clientX: window.innerWidth / 2, clientY: 50 };
        this.snapService.show(
          "Sesión Finalizada",
          safeEvent as any,
          "info",
          "fa-sign-out-alt",
        );

        if (stayInConfig) {
          this.showControlPanel = true;
          this.loadConnections();
        } else {
          this.showControlPanel = false;
        }
      } catch (e) {
        console.error("Error al desconectar:", e);
        this.modalService.showGenericModal(
          "Error",
          "Error al desconectar: " + e,
          "error",
        );
      }
    };

    if (!this.getJwtToken() || this.wsStatus !== "Conectado") {
      await performDisconnect();
    } else {
      const confirmed = await this.modalService.showQuestionModal(
        "Confirmar Desconexión",
        "¿Estás seguro de que deseas desconectarte? Se cerrará la sesión actual y será necesario ingresar credenciales nuevamente.",
        "Desconectar",
        "Mantener Conexión",
      );
      if (confirmed) {
        await performDisconnect();
      }
    }
  }

  /**
   * Cierra todas las pestañas dinámicas y destruye los webviews nativos.
   */
  async closeAllTabsAndWebviews() {
    // console.log("🗑️ [System] Cerrando todas las pestañas y webviews...");

    // 1. Cerrar todos los webviews nativos activos y borrar sus datos de navegación
    for (const tabId of Object.keys(this.activeNativeWebviews)) {
      try {
        console.log(
          `🗑️ [Native Webview] Limpiando cache y destruyendo webview para: ${tabId}`,
        );
        await this.activeNativeWebviews[tabId].clearAllBrowsingData();
        await this.activeNativeWebviews[tabId].close();
      } catch (e) {
        console.error("Error al cerrar/limpiar webview nativo:", e);
      }
      delete this.activeNativeWebviews[tabId];
    }

    // 2. Limpiar todos los logs (memoria y base de datos backend)
    await this.logger.clearLogs();

    // 3. Limpiar todos los tabs en el estado global
    this.appState.clearAllTabs();
  }

  /**
   * Limpia todos los rastros de la sesión actual sin cerrar la aplicación.
   * Centraliza la lógica de "Logout" para reutilización.
   */
  async performLocalLogout() {
    // console.log("🔐 [System] Ejecutando limpieza de sesión local...");

    // 1. Notificar a todas las pestañas tipo iframe que limpien su sesión antes de desmontarlas
    try {
      const tabs = this.appState.getTabsSnapshot();
      for (const tab of tabs) {
        if (!tab.type || tab.type === "iframe") {
          const iframeId = "iframe-" + tab.id;
          const iframeExtId = "iframe-ext-" + tab.id;
          const iframe = (document.getElementById(iframeId) ||
            document.getElementById(iframeExtId)) as HTMLIFrameElement;

          if (iframe && iframe.contentWindow) {
            const targetOrigin =
              iframe.src && iframe.src.startsWith("http")
                ? new URL(iframe.src).origin
                : "*";

            console.log(
              `🔑 [System] Enviando señales de cierre a iframe de pestaña: ${tab.id}`,
            );

            // Enviar mensaje CLEAR_SESSION
            iframe.contentWindow.postMessage(
              {
                type: "CLEAR_SESSION",
                keyName: this.config?.access?.jwtVariableName || "token",
              },
              targetOrigin,
            );

            // Enviar mensaje SET_SESSION con token: null para compatibilidad
            iframe.contentWindow.postMessage(
              {
                type: "SET_SESSION",
                token: null,
              },
              targetOrigin,
            );
          }
        }
      }
    } catch (e) {
      console.error("Error enviando señales de limpieza a los iframes:", e);
    }

    // Esperar un breve momento (150ms) para que el navegador complete el postMessage antes de destruir los iframes del DOM
    await new Promise((resolve) => setTimeout(resolve, 150));

    // 2. Cerrar todas las pestañas y webviews
    await this.closeAllTabsAndWebviews();

    // 3. Limpiar Storage de sesión completamente
    sessionStorage.clear();

    // 4. Limpiar Token JWT explícitamente por si acaso (aunque se limpie con storage.clear)
    const storage =
      this.config.access.jwtStorage === "sessionStorage"
        ? sessionStorage
        : localStorage;
    storage.removeItem(this.config.access.jwtVariableName);

    // Limpiar localStorage de sesión y caches, manteniendo solo configuraciones globales
    const keysToKeep = ["sdc_ui_config", "sandra_perf_mode"];
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && !keysToKeep.includes(key)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => {
      localStorage.removeItem(k);
    });

    // Asegurarse de eliminar jwt y config de red residuales explícitamente
    localStorage.removeItem("active_connection");
    localStorage.removeItem("token");
    sessionStorage.removeItem("token");

    // 4. Resetear estados visuales y de sesión
    this.activeConnection = null;
    this.wsStatus = "Desconectado";
    this.sessionUsername = "";
    this.sessionTimeRemaining = "";
    this.sessionSecondsLeft = 0;
    this.jwtWarningShown = false;

    // 5. Limpiar cualquier puerto de autorización pendiente
    this.authPorts.clear();

    // 6. Redireccionar al Dashboard (Zona Pública)
    this.appState.setActiveTab("dashboard");
  }

  /**
   * Realiza un cierre de sesión completo: desconexión del servidor y limpieza local.
   */
  public async performFullLogout() {
    console.log("🚫 [System] Iniciando Cierre de Sesión Completo...");

    // 1. Desconectar del servidor si hay conexión activa
    if (this.activeConnection) {
      try {
        await this.sdcService.disconnectFromServer(
          this.activeConnection,
          this.clientId,
        );
        console.log("🔌 Desconectado del servidor correctamente.");
      } catch (e) {
        console.error(
          "Error desconectando del servidor durante logout forzado:",
          e,
        );
      }
    }

    // 2. Limpiar estados locales y redireccionar
    await this.performLocalLogout();

    // 3. Mostrar notificación
    this.snapService.show(
      "Sesión Cerrada Totalmente",
      undefined,
      "info",
      "fa-sign-out-alt",
    );
  }

  /**
   * Realiza el cierre de sesión específico para cuando el token expira.
   */
  async handleSessionExpiration() {
    console.log("🔐 [System] Iniciando Cierre de Sesión por Expiración...");

    // 1. Desconectar del servidor si hay conexión activa
    if (this.activeConnection) {
      try {
        await this.sdcService.disconnectFromServer(
          this.activeConnection,
          this.clientId,
        );
        console.log(
          "🔌 Desconectado del servidor correctamente por expiración.",
        );
      } catch (e) {
        console.error(
          "Error desconectando del servidor durante expiración de sesión:",
          e,
        );
      }
    }

    // 2. Limpiar estados locales y redireccionar
    await this.performLocalLogout();

    // 3. Mostrar notificación de expiración
    this.snapService.show(
      "Sesión expirada por límite de tiempo",
      undefined,
      "warning",
      "fa-clock",
    );
  }

  /**
   * Maneja el cierre del modal de login, forzando logout si era requerido para navegación.
   */
  handleLoginModalClose() {
    this.showLoginModal = false;

    // Si el modal se cerró y teníamos una navegación pendiente a área protegida,
    // asumimos que el login falló o fue cancelado.
    if (this.pendingNavTab) {
      console.warn(
        `⚠️ [System] Login cancelado para área protegida: ${this.pendingNavTab}. Forzando Logout.`,
      );
      this.performFullLogout();
      this.pendingNavTab = null;
    }

    if (this.pendingAppToOpen) {
      console.warn(
        "⚠️ [System] Login cancelado. Cancelando apertura de la app.",
      );
      this.pendingAppToOpen = null;
    }
  }

  // --- Application Lifecycle & Setup ---

  showSetupWizard = false;

  async checkLoaderReady(): Promise<void> {
    try {
      const isReady = await invoke<boolean>("is_loader_ready");
      if (isReady) {
        return;
      }
      return new Promise<void>((resolve) => {
        const unlistenPromise = listen("loader-sequence-ready", () => {
          unlistenPromise.then((unlisten) => unlisten());
          resolve();
        });
      });
    } catch (e) {
      console.warn("Error checking loader readiness:", e);
    }
  }

  async initApplication() {
    // Esperar a que la secuencia de carga de Rust (Stack Loader) se complete
    if ((window as any).__TAURI__) {
      await this.checkLoaderReady();
    }

    // Opcional: Chequeo de actualizaciones automático si está habilitado
    if (this.config.updates.autoUpdate) {
      setTimeout(() => {
        this.updateService.checkAndPrompt(true); // Silent check
      }, 5000);
    }

    try {
      // 1. Huella Única del Terminal (Inmutable)
      await invoke("emit_splash_status", {
        message: "Iniciando Kernel Sandra...",
      });
      this.clientId = await this.sdcService.getClientId();

      // 2. Validar identidad
      const setupStatus = await invoke<any>("get_setup_status");

      // Cargar Identidad del Sistema (MAC, IP, SO) para el Wizard
      await this.refreshStats();
      await this.loadNetwork();

      if (!setupStatus.is_done) {
        // No configurado -> Mostrar Wizard después de cerrar splash
        await invoke("emit_splash_status", {
          message: "Requiere Configuración",
        });
        await invoke("close_splash");
        this.zone.run(() => {
          console.log("🚀 [Init] Activando Setup Wizard...");
          this.showSetupWizard = true;
        });
      } else {
        // Configurado -> Intentar conexión
        if (setupStatus.machine_name) {
          const name = setupStatus.machine_name;
          const parts = name.split(/[-_]/);
          if (parts.length > 1) {
            this.machineNameMain = parts[0];
            this.machineNameSuffix = parts.slice(1).join("-");
          } else {
            this.machineNameMain = name;
            this.machineNameSuffix = "";
          }
          this.machineArea = setupStatus.machine_area || "";
        }
        await invoke("emit_splash_status", {
          message: `Bienvenido, ${setupStatus.machine_name}`,
        });
      }

      // Cargar conexiones existentes
      await this.loadConnections();

      // Si no hay marcada como conectada, pero hay al menos una, comprobamos múltiples
      if (!this.activeConnection) {
        if (this.availableConnections.length > 1) {
          console.log("ℹ️ [Init] Múltiples perfiles. Solicitando selección.");
          await invoke("emit_splash_status", {
            message: "Seleccionando Perfil de Red...",
          });

          await invoke("close_splash");
          this.zone.run(() => {
            this.loginConnections = this.availableConnections;
            this.showConnectionSelectorInModal = true;
            this.requireJwtLogin = this.config.access.enableJwtSession;
            this.showLoginModal = true;
          });

          return; // Termina la inicialización, el flujo continúa a través del Modal
        } else if (this.availableConnections.length === 1) {
          this.activeConnection = this.availableConnections[0];
          // console.log(
          //   "[Init] Usando único perfil disponible:",
          //   this.activeConnection.name,
          // );
        } else {
          await invoke("emit_splash_status", {
            message: "Sin Perfiles de Conexión",
          });
          console.log(
            "⚠️ [Init] No se encontró ninguna conexión para auto-consecución.",
          );
        }
      }

      if (this.activeConnection) {
        // console.log("🔌 [Init] Auto-conectando a:", this.activeConnection.name);
        await invoke("emit_splash_status", {
          message: `Enlazando con ${this.activeConnection.name}...`,
        });

        // Refresco proactivo
        try {
          await this.sdcService.disconnectFromServer(
            this.activeConnection,
            this.clientId,
          );
        } catch (e) {}

        await this.sdcService.connectToServer(
          this.activeConnection,
          this.clientId,
        );
        await invoke("emit_splash_status", { message: "Enlace Establecido" });

        // Validar si requiere JWT aunque sea conexión única autoseleccionada
        if (this.config.access.enableJwtSession && !this.getJwtToken()) {
          setTimeout(() => {
            this.checkAndPromptJwt(true, false);
          }, 500);
        }
      }

      await invoke("close_splash");
    } catch (e) {
      console.error("Error during initApplication:", e);
      // Fallback: cerrar splash para no bloquear al usuario
      await invoke("close_splash");
    }
  }

  // ...

  logoutStep: string = "";

  async handleConnectionSelect(conn: any) {
    // console.log("🔌 [Selector] Conexión seleccionada:", conn.name);
    this.isChangingConnection = true;
    this.requireJwtLogin = true; // Forzar que la modal requiera credenciales
    try {
      if (this.activeConnection) {
        await this.performLocalLogout();
      }
      this.activeConnection = conn;
      localStorage.setItem("active_connection", JSON.stringify(conn));

      await this.sdcService
        .disconnectFromServer(conn, this.clientId)
        .catch(() => {});
      await this.sdcService.connectToServer(conn, this.clientId);
      this.wsStatus = "Reintentando"; // Initial state, will update via event listener
      await this.loadConnections(); // Sync is_connected ref

      // Forzar la visualización de la ventana de login (Acceso Requerido)
      this.checkAndPromptJwt(true, true);
    } catch (e) {
      console.error("Error conectando tras selección de perfil:", e);
      this.showModal(
        "Error de Conexión",
        "Revisa que tu servidor Sandra esté ejecutándose localmente: " + e,
      );
    } finally {
      this.isChangingConnection = false;
    }
  }

  async handleExitRequest() {
    this.exitModal = { show: true, closing: false };
  }

  async confirmExit() {
    this.exitModal.closing = true;

    try {
      // Step 1: Disconnect from Server
      this.logoutStep = "Desconectando del Servidor";
      if (this.activeConnection) {
        console.log("🔌 Reportando cierre a Sandra Server...");
        await this.sdcService.disconnectFromServer(
          this.activeConnection,
          this.clientId,
        );
      }
      await new Promise((r) => setTimeout(r, 800)); // Visual delay

      // Step 2: Disconnect WebSocket (Simulated wait as actual socket closes with disconnectFromServer)
      this.logoutStep = "Desconectando el WebSocket";
      await new Promise((r) => setTimeout(r, 800)); // Visual delay

      // Step 3 & 4: Clear Storage & JWT Connections (Unified)
      this.logoutStep = "Limpiando rastros de sesión";
      await this.performLocalLogout();
      await new Promise((r) => setTimeout(r, 800)); // Visual delay

      // Final Exit
      this.isExitConfirmed = true;
      console.log("🚀 [System] Ejecutando exit_app...");
      await invoke("exit_app");
    } catch (e) {
      console.error("Error al cerrar sesión durante salida:", e);
      this.isExitConfirmed = true;
      await invoke("exit_app");
    }
  }

  async handleSetupComplete(data: any) {
    try {
      this.showSetupWizard = false;
      this.showModal(
        "Configurando",
        "Registrando identidad y enlace de red...",
      );

      // 1. Guardar Identidad en Rust
      await invoke("save_setup_data", {
        name: data.name,
        description: data.description,
        area: data.area,
      });

      // 2. Guardar Conexión Inicial
      const connData = {
        name: data.connName,
        ip_address: data.ip_address,
        port: Number(data.port),
        wss_host: data.wss_host || null,
        wss_port: Number(data.wss_port) || null,
        is_connected: false, // Se activará ahora
      };

      const connId = await invoke<number>("save_connection", { connData });
      (connData as any).id = connId;

      // 3. Activar Conexión Inmediatamente
      await this.sdcService.connectToServer(connData, this.clientId);

      this.showModal(
        "Configuración Finalizada",
        `Tu terminal '${data.name}' ha sido registrado y conectado exitosamente.`,
      );

      // Recargar todo el estado
      await this.loadConnections();
      await this.refreshStats();

      // Trigger Post-Setup JWT Prompt
      setTimeout(async () => {
        const confirmed = await this.modalService.showQuestionModal(
          "Activar Seguridad JWT",
          "¿Desea activar la protección por token JWT de Sandra-Security ahora?\n\nEsto habilitará servicios avanzados como notificación en tiempo real y protegerá secciones sensibles.",
          "Sí, Activar JWT",
          "No, Quizás Luego",
        );
        if (confirmed) {
          this.showJwtSetupModal = true;
        }
      }, 3500); // Dar algo de buffer después del Toast Finalizado
    } catch (e) {
      console.error("Error in setup complete:", e);
      this.showModal("Error", "No se pudo completar la configuración: " + e);
    }
  }

  getAppProtocolBase(): string {
    const ua = window.navigator.userAgent.toLowerCase();
    if (
      ua.includes("windows") ||
      ua.includes("win64") ||
      ua.includes("win32")
    ) {
      return "http://sandra-app.localhost";
    }
    return "sandra-app://localhost";
  }

  openApp(app: any) {
    if (!this.activeConnection || this.wsStatus !== "Conectado") {
      this.showModal(
        "Sin Conexión Activa",
        "Debes estar conectado a un servidor para abrir aplicaciones.",
      );
      return;
    }

    if (this.config.access.enableJwtSession && !this.getJwtToken()) {
      this.pendingAppToOpen = app;
      this.checkAndPromptJwt(true);
      return;
    }

    // Fix: Los datos pueden estar en _original o directamente en app
    const appData = app._original || app;
    const targetUrl = appData.external_url || appData.externalUrl || "";
    const appId = (appData.app_id || app.id)?.toString() || "";

    let rawUrl = "";
    let isExternalMode = false;

    // console.log("📋 App data:", appData);
    // console.log("🔑 Flags:", {
    //   is_bypass: appData.is_bypass,
    //   is_csrf_sync: appData.is_csrf_sync,
    //   is_limitless: appData.is_limitless,
    //   is_external_browser: appData.is_external_browser,
    //   is_proxy_required: appData.is_proxy_required,
    //   targetUrl: targetUrl,
    // });

    const protocolBase = this.getAppProtocolBase();

    // Lógica inteligente de URL:
    // 0. Modo Bypass (pass-through sin modificación)
    if (appData.is_bypass) {
      if (!targetUrl) {
        this.showModal(
          "Error de Configuración",
          "La aplicación en modo Bypass no tiene URL definida.",
        );
        return;
      }
      const target = encodeURIComponent(targetUrl);
      rawUrl = `${protocolBase}/bypass-proxy/${appId}/?target=${target}`;
      // console.log(`🚧 [Bypass Nav] Opening ${appData.name} -> ${rawUrl}`);
    }
    // 1. Modo CSRF Sync (auto-sincroniza tokens CSRF)
    else if (appData.is_csrf_sync) {
      if (!targetUrl) {
        this.showModal(
          "Error de Configuración",
          "La aplicación CSRF Sync no tiene URL definida.",
        );
        return;
      }
      const target = encodeURIComponent(targetUrl);
      rawUrl = `${protocolBase}/csrf-sync-proxy/${appId}/?target=${target}`;
      // console.log(`🔐 [CSRF Sync Nav] Opening ${appData.name} -> ${rawUrl}`);
    }
    // 2. Modo "Motor Limitless" (Proxied via Rust CookieJar)
    else if (appData.is_limitless) {
      if (!targetUrl) {
        this.showModal(
          "Error de Configuración",
          "La aplicación Limitless no tiene URL definida.",
        );
        return;
      }
      const target = encodeURIComponent(targetUrl);
      rawUrl = `${protocolBase}/limitless-proxy/${appId}/?target=${target}`;
      // console.log(`🚀 [Limitless Nav] Opening ${appData.name} -> ${rawUrl}`);
    }
    // 3. Modo "Navegador Libre" (Apertura como Native Child Webview)
    else if (appData.is_external_browser) {
      if (!targetUrl) {
        this.showModal(
          "Error de Configuración",
          "La aplicación está marcada como 'Externa' pero no tiene URL definida.",
        );
        return;
      }
      // console.log(
      //   `🌐 [Native Browser Mode] Creando Webview para -> ${targetUrl}`,
      // );
      rawUrl = targetUrl;
      isExternalMode = true;

      const safeAppId = appId.replace(/[^a-zA-Z0-9\-\/:_]/g, "-");
      const webviewId = `webview-${safeAppId}-${Date.now()}`;
      const appWindow = getCurrentWindow();

      const webview = new Webview(appWindow, webviewId, {
        url: targetUrl,
        x: window.innerWidth, // Oculto inicialmente
        y: window.innerHeight,
        width: 100,
        height: 100,
      });

      webview.once("tauri://created", () => {
        // console.log(`✅ [Native Webview] Creado exitosamente: ${webviewId}`);
        this.activeNativeWebviews[appData.id.toString()] = webview;
        // Espera 1.2 segundos para mostrar el cargador premium y evitar flashes blancos de renderizado
        setTimeout(() => this.syncNativeWebviews(), 1200);
      });

      webview.once("tauri://error", (e) => {
        // console.error(`❌ [Native Webview] Error al crear: ${webviewId}`, e);
        this.showModal("Error", "No se pudo crear el navegador nativo.");
      });
    }
    // 4. Si la App requiere Proxy -> Forzar sandra-app://
    else if (targetUrl && appData.is_proxy_required) {
      const target = encodeURIComponent(targetUrl);
      rawUrl = `${protocolBase}/external-proxy/${appId}/?target=${target}`;
      // console.log(
      //   `🛡️ [Proxy Nav] Wrapping External ${appData.name} -> ${rawUrl}`,
      // );
    } else if (targetUrl) {
      // Caso Externa Directa
      rawUrl = targetUrl;
      // console.log(`🌍 [External Nav] Direct ${appData.name} -> ${rawUrl}`);
    } else {
      // Caso Local
      rawUrl = `${protocolBase}/${appId}/`;
      // console.log(`🏠 [Local Nav] Opening ${appData.name} via ${rawUrl}`);
    }

    const safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(rawUrl);
    this.appState.addTab({
      id: appData.id.toString(),
      name: appData.name,
      icon: appData.icon,
      url: safeUrl,
      isProxyRequired: appData.is_proxy_required,
      isExternal: !targetUrl,
      isExternalMode: isExternalMode,
      appId: appId.toString(),
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
    this.syncNativeWebviews();
  }

  checkSidebarResponsive(width: number) {
    // Definir páginas estáticas donde el sidebar SI puede aparecer (sujeto a resolución)
    const staticPages = [
      "dashboard",
      "connections",
      "security",
      "monitor",
      "proyectos",
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
    this.appState.setActiveTab(this.appState.getLastDashboardSnapshot());
  }

  loadConfig() {
    const saved = localStorage.getItem("sdc_ui_config");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.config = { ...this.config, ...parsed };
        if (parsed.access) {
          this.config.access = { ...this.config.access, ...parsed.access };
        }

        // AUTO-HEAL: Si al cargar detectamos un token pero la sesión está desactivada, la activamos.
        // Esto previene que los menús arranquen bloqueados si el usuario no activó el check manualmente.
        const storage =
          this.config.access.jwtStorage === "sessionStorage"
            ? sessionStorage
            : localStorage;
        const token = storage.getItem(this.config.access.jwtVariableName);
        if (token && !this.config.access.enableJwtSession) {
          console.log(
            "🛠️ [App] Sincronizando estado de sesión JWT desde almacenamiento.",
          );
          this.config.access.enableJwtSession = true;
        }
      } catch (e) {
        console.error("Error loading config", e);
      }
    }
  }

  saveConfig(silent = false) {
    localStorage.setItem("sdc_ui_config", JSON.stringify(this.config));
    this.applyTheme(); // Aplicar tema al guardar
    if (!silent) {
      this.showModal(
        "Configuración Guardada",
        "Los ajustes se han persistido localmente.",
        "success",
      );
    }
    this.showControlPanel = false;
  }

  applyTheme() {
    let theme = this.config.theme || "sandra";
    if (theme === "light") theme = "sandra";

    // Remover temas previos
    document.body.classList.remove(
      "theme-claro",
      "theme-oscuro",
      "theme-sandra",
      "theme-verde-mate",
    );
    // Aplicar nuevo tema
    document.body.classList.add(`theme-${theme}`);
    // console.log(`🎨 [Theme] Aplicado: ${theme}`);
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
    return this.utils.formatBytes(bytes);
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
      title: "Confirmar Desinstalación",
      message: `¿Eliminar ${app.name}?`,
      appName: app.name, // Añadido para el nuevo modal elegante
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
  unlockTabPin = "";
  tabToUnlock: any = null;

  // DevTools Key Access State
  showDevToolsModal = false;
  devToolsPassword = "";

  openDevToolsAccess() {
    this.devToolsPassword = "";
    this.showDevToolsModal = true;
  }

  cancelDevToolsUnlock() {
    this.showDevToolsModal = false;
    this.devToolsPassword = "";
  }

  async submitDevToolsUnlock() {
    if (!this.devToolsPassword) return;
    if (this.devToolsPassword === "230785") {
      this.showDevToolsModal = false;
      this.devToolsPassword = "";
      try {
        await invoke("open_devtools");
      } catch (err) {
        console.error("Error opening devtools via Tauri invoke:", err);
      }
    } else {
      this.showModal(
        "Acceso Denegado",
        "La clave de acceso ingresada es incorrecta.",
        "error",
      );
    }
  }

  unlockTab(tab: any) {
    if (!tab.filePath && !tab.hiddenContent) {
      this.showModal(
        "Error",
        "No se puede determinar la ruta del archivo original. Asegúrate de abrirlo desde el Historial.",
      );
      return;
    }
    this.tabToUnlock = tab;
    this.unlockTabPin = "";
    this.showUnlockTabModal = true;
  }

  cancelTabUnlock() {
    this.showUnlockTabModal = false;
    this.tabToUnlock = null;
    this.unlockTabPin = "";
  }

  async submitTabUnlock() {
    if (!this.unlockTabPin || !this.tabToUnlock) return;
    this.showUnlockTabModal = false;

    try {
      let base64Data = "";

      // Opción A: Desbloqueo en Memoria (Recién abierto)
      if (this.tabToUnlock.hiddenContent) {
        // Validación simple de PIN (TODO: Mejorar seguridad en producción)
        if (this.unlockTabPin !== "1234") {
          throw "PIN Incorrecto";
        }
        base64Data = this.tabToUnlock.hiddenContent;
        this.tabToUnlock.hiddenContent = undefined; // Limpiar memoria
      }
      // Opción B: Desbloqueo desde Disco (Historial)
      else if (this.tabToUnlock.filePath) {
        base64Data = await invoke<string>("load_sse_document", {
          filePath: this.tabToUnlock.filePath,
          unlockPin: this.unlockTabPin,
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
      const blob = new Blob([byteArray], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);

      const dataUri = base64Data.startsWith("data:")
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
      if (e && typeof e === "string" && e.includes("PIN Incorrecto")) {
        this.showModal("Error de PIN", "El PIN es incorrecto.");
      } else {
        const msg = typeof e === "string" ? e : e.message || JSON.stringify(e);
        this.showModal("Error", "No se pudo desbloquear: " + msg);
      }
    } finally {
      this.tabToUnlock = null;
      this.unlockTabPin = "";
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
    // const logInfo =
    //   payload?.fileName ||
    //   (type === "EXEC_FNX_FINALIZADO" ? payload?.taskId : "");
    // console.log(
    //   `📥 [Bridge] Mensaje recibido: ${type}${logInfo ? " – " + logInfo : ""}`,
    // );

    switch (type) {
      case "DOWNLOAD_PDF":
      case "DOWNLOAD_FILE":
      case "DOWNLOAD_EXCEL":
      case "DOWNLOAD_CSV":
      case "DOWNLOAD_TXT":
      case "DOWNLOAD_IMG":
      case "DOWNLOAD_PNG":
        await this.handleIframeDownload(payload.fileName, payload.data);
        break;

      case "OPEN_PDF":
      case "OPEN_PDF_SECURITY":
        await this.handleIframeOpen(
          payload.fileName,
          payload.data,
          false,
          false,
          "pdf-viewer",
        );
        break;

      case "OPEN_CSV":
      case "OPEN_TXT":
      case "OPEN_IMG":
      case "OPEN_PNG":
        await this.handleIframeOpen(
          payload.fileName,
          payload.data,
          false,
          false,
          "file-viewer",
        );
        break;

      case "OPEN_SSE":
      case "OPEN_SSE_SECURITY":
        await this.handleIframeOpen(
          payload.fileName,
          payload.data,
          true,
          payload.isSaved || false,
          "pdf-viewer",
        );
        break;

      case "OPEN_PDF_HACK":
        await this.handlePdfHack(payload.fileName, payload.data, payload.meta);
        break;

      case "SOLICITAR_AUTORIZACION":
        try {
          const { authId, payload, content } = event.data;
          const normalizedId = (authId || "").toLowerCase();

          // Convert content to string if it's an object, as Rust expects a String
          const contentStr =
            typeof content === "object" ? JSON.stringify(content) : content;

          await invoke("register_authorization_ticket", {
            authId,
            payload,
            content: contentStr,
          });

          // Save the message port to reply back later
          if (event.ports && event.ports.length > 0) {
            console.log(
              `📥 [Sec] Registrando puerto para Ticket: ${normalizedId}`,
            );
            this.authPorts.set(normalizedId, event.ports[0]);
          } else {
            console.warn(
              `⚠️ [Sec] No se recibió MessagePort para Ticket: ${normalizedId}`,
            );
          }

          this.pendingTicketsCount++;
        } catch (e: any) {
          console.error("Error al registrar autorización en Rust:", e);
          this.snapService.show(
            "Error al registrar autorización",
            undefined,
            "error",
          );
        }
        break;

      case "CONSULTAR_ESTADO_AUTORIZACION":
        try {
          const authId = event.data.authId;
          const normalizedId = (authId || "").toLowerCase();
          console.log(`📡 [Sync] Solicitud manual para: [${authId}]`);

          // Consultar a Rust el estado real del ticket
          const ticket = await invoke<any>("get_authorization_ticket_by_id", {
            authId,
          });

          if (
            ticket &&
            ticket.status &&
            ticket.status.toLowerCase() === "procesado"
          ) {
            console.log(
              `✅ [Sync] Ticket ${authId} APROBADO. Preparando respuesta.`,
            );

            const port = this.authPorts.get(normalizedId);
            console.log(
              `🔌 [Sync] Puerto para ${normalizedId}:`,
              port ? "CONECTADO" : "FALLBACK (Window)",
            );

            // Intentar parsear el contenido si viene como string
            let finalData = ticket.content;
            try {
              if (typeof ticket.content === "string") {
                finalData = JSON.parse(ticket.content);
              }
            } catch (e) {
              console.warn(
                `⚠️ [Sync] No se pudo parsear como JSON para ${authId}`,
                e,
              );
            }

            const responseData = {
              type: "AUTORIZACION_APROBADA",
              authId: authId,
              data: finalData,
            };

            if (port) {
              port.postMessage(responseData);
              this.authPorts.delete(normalizedId);
            } else if (event.source) {
              (event.source as Window).postMessage(responseData, {
                targetOrigin: "*",
              } as any);
            }
          } else {
            console.log(
              `⏳ [Sync] Ticket ${authId} sigue en estado: ${ticket?.status || "desconocido"}`,
            );
          }
        } catch (e: any) {
          console.error("❌ [Sync] Error en consulta manual:", e);
        }
        break;

      case "START_DOWNLOAD":
        console.log("Contando las veces que paso por aqui ");
        this.handleStartDownload(event.data);
        break;

      default:
        break;
    }
  }

  /**
   * Track by function for the openTabs loop to prevent iframe recreating on every change detection.
   */
  trackByTabId(index: number, tab: any): string {
    return tab.id;
  }

  async handleIframeOpen(
    fileName: string,
    dataUri: string,
    isProtected: boolean,
    isSaved: boolean = false,
    viewerType: "pdf-viewer" | "file-viewer" = "pdf-viewer",
  ) {
    // --- Secure Viewer Logic (Intercept Protected Docs) ---
    if (isProtected) {
      try {
        const base64 = dataUri.includes("base64,")
          ? dataUri.split("base64,")[1]
          : dataUri;
        // Call Rust to split PDF (Cover vs Content)
        const res = await invoke<{ cover: string; content: string }>(
          "prepare_sse_preview",
          { pdfBase64: base64 },
        );

        // Convert Cover to BlobUrl for View
        const byteCharacters = atob(res.cover);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);

        const tabId = "doc-view-" + Date.now();

        this.appState.addTab({
          id: tabId,
          name: fileName.replace(/\.pdf$/i, ".sse"),
          icon: "fas fa-file-shield",
          type: "pdf-viewer",
          content: safeUrl, // Visible: Cover Page (QR)
          url: safeUrl,
          blobData: dataUri, // Save/History: Original Full PDF
          originalName: fileName,
          isProtected: true,
          isSavedToHistory: isSaved,
          showToolbar: true,
          zoomLevel: 1.0,
          isLocked: true, // Flag: Locked State
          hiddenContent: res.content, // Unlock Data: Content Pages
        });

        // Show unlock modal immediately if desired, or let user click button.
        // User requested: "queda habilitado el boton desbloquear". So we just open the tab locked.
        return;
      } catch (e) {
        console.error(
          "Error creating secure preview, falling back to standard view:",
          e,
        );
        // Fallthrough to standard logic below
      }
    }

    // --- Standard Logic (Original) ---
    try {
      const res = await fetch(dataUri);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);

      const tabId = "doc-view-" + Date.now();
      const ext = fileName.split(".").pop()?.toLowerCase();

      let icon = "fas fa-file-pdf";
      if (ext === "txt") icon = "fas fa-file-alt";
      else if (ext === "xlsx" || ext === "xls") icon = "fas fa-file-excel";
      else if (["png", "jpg", "jpeg", "gif", "svg"].includes(ext || ""))
        icon = "fas fa-file-image";

      let csvHeader: string[] = [];
      let csvRows: string[][] = [];
      let csvSearchCache: string[] = [];
      let finalViewerType: any = viewerType;

      if (ext === "csv") {
        this.appState.setGlobalLoading(
          true,
          "Analizando base de datos masiva...",
        );
        try {
          const { header, rows } = await this.fileService.parseCSV(blob);
          if (header.length > 0) {
            csvHeader = header;
            csvRows = rows;
            finalViewerType = "csv-viewer";
            icon = "fas fa-table-list";

            // OPTIMIZATION: Pre-calculate lowercase strings for fast full-text search
            console.log(
              `⚡ [Performance] Generando cache de búsqueda para ${rows.length} registros...`,
            );
            csvSearchCache = rows.map((row) => row.join(" ").toLowerCase());
          }
        } catch (csvErr) {
          console.error("Error parsing CSV for grid view:", csvErr);
        } finally {
          this.appState.setGlobalLoading(false);
        }
      }

      let txtContent: string | undefined = undefined;
      let txtLines: string[] | undefined = undefined;
      let txtTotalLines: number | undefined = undefined;
      let txtIsTruncated = false;

      if (ext === "txt") {
        this.appState.setGlobalLoading(true, "Cargando documento de texto...");
        try {
          const fullText = await blob.text();
          txtLines = fullText.split(/\r?\n/);
          txtTotalLines = txtLines.length;

          if (txtLines.length > 1000) {
            txtIsTruncated = true;
            console.log(
              `⚡ [Performance] Archivo de texto grande (${txtTotalLines} lineas). Truncando vista a 1000...`,
            );
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
        name: isProtected ? fileName.replace(/\.pdf$/i, ".sse") : fileName,
        icon: isProtected ? "fas fa-file-shield" : icon,
        type: finalViewerType as any,
        content: safeUrl,
        url: safeUrl,
        blobData: dataUri, // Save raw data for later actions (Save/History)
        originalName: fileName, // Save name
        isProtected: isProtected, // Pass protection status
        isSavedToHistory: isSaved, // Control History Button
        showToolbar: true, // ENABLE Toolbar for API calls
        zoomLevel: 1.0, // Init Zoom
        mimeType: ext === "txt" ? "text/plain" : blob.type, // Guardar mimeType para el visor
        csvHeader,
        csvRows,
        csvVisibleColumns: [...csvHeader],
        csvSearchCache,
        txtContent,
        txtLines,
        txtTotalLines,
        txtIsTruncated,
      });
    } catch (e) {
      console.error("Error opening document tab:", e);
    }
  }
  async handleSSEDownload(fileName: string, dataUri: string) {
    try {
      const base64 = dataUri.split(",")[1];
      const finalName = fileName.replace(/\.pdf$/i, "") + ".sse";

      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: finalName,
        filters: [
          {
            name: "Bunker Secure Document",
            extensions: ["sse"],
          },
        ],
      });

      if (!path) return; // Cancelled

      await invoke("save_protected_pdf", {
        pdfBase64: base64,
        filePath: path,
        pin: "1234", // Default or Todo: Ask User
      });

      await invoke("add_document_history", {
        fileName: finalName,
        filePath: path,
        fileSize: "Local",
        remoteCode: "",
        source: "GLOBAL",
        userLogin: this.securityService.getCurrentUserLogin(),
      });
      this.showModal(
        "Descarga Completada",
        `Archivo protegido guardado en: ${path}`,
      );
    } catch (e: any) {
      console.error("Error saving SSE:", e);
      const msg = typeof e === "string" ? e : e.message || JSON.stringify(e);
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
      const { tempDir, join } = await import("@tauri-apps/api/path");
      const tempPath = await tempDir();

      const base64 = tab.blobData.split(",")[1];

      let fullPath = "";
      let savedName = tab.originalName;

      if (tab.isProtected) {
        // SSE Conversion Case
        // Change extension to .sse
        savedName = tab.originalName.replace(/\.pdf$/i, ".sse");
        const tempName = `cached_${Date.now()}_${savedName}`;
        fullPath = await join(tempPath, tempName);

        // Use Rust command to save as SSE (Encrypted)
        await invoke("save_protected_pdf", {
          pdfBase64: base64,
          filePath: fullPath,
          pin: "1234",
        });
      } else {
        // Standard File Case (CSV, PDF, Images, etc.)
        const tempName = `cached_${Date.now()}_${tab.originalName}`;
        fullPath = await join(tempPath, tempName);

        const binaryData = Uint8Array.from(atob(base64), (c) =>
          c.charCodeAt(0),
        );
        const { writeFile } = await import("@tauri-apps/plugin-fs");
        await writeFile(fullPath, binaryData);
      }

      await invoke("add_document_history", {
        fileName: savedName,
        filePath: fullPath,
        fileSize: "LocalCache",
        remoteCode: tab.id,
        source: "APP_CACHE",
        userLogin: this.securityService.getCurrentUserLogin(),
      });

      // HIDE HISTORY BUTTON
      tab.isSavedToHistory = true;

      this.snapService.show("Guardado en Historial", undefined, "success");
    } catch (e: any) {
      console.error("History save error:", e);
      const msg = typeof e === "string" ? e : e.message || JSON.stringify(e);
      this.showModal("Error de Guardado", msg);
    }
  }

  // Generic Modal Logic
  showModal(
    title: string,
    message: string,
    forceType?: "success" | "error" | "info" | "warning",
    infoIcon?: string,
  ) {
    let type: "success" | "error" | "info" | "warning" = "info";
    const t = title.toLowerCase();

    if (forceType) {
      type = forceType;
    } else if (
      t.includes("error") ||
      t.includes("falla") ||
      t.includes("aviso")
    ) {
      type = "error";
    } else if (
      t.includes("finalizada") ||
      t.includes("éxito") ||
      t.includes("exito") ||
      t.includes("actualizado")
    ) {
      type = "success";
    }

    this.modalService.showGenericModal(
      title,
      message,
      type,
      infoIcon || "fa-info-circle",
    );
  }

  async downloadPdfFromTab(tab: Tab) {
    if (!tab.blobData || !tab.originalName) return;

    let dataToDownload = tab.blobData;
    let finalFileName = tab.originalName;

    // --- CSV ALCHEMY: Filter columns and format dates for safe export ---
    if (tab.type === "csv-viewer" && tab.csvHeader && tab.csvRows) {
      console.log(
        "🧪 [Alchemy] Formateando fechas y columnas para exportación segura...",
      );

      const visibleCols = tab.csvVisibleColumns || tab.csvHeader;
      const visibleIndices = visibleCols
        .map((name) => tab.csvHeader!.indexOf(name))
        .filter((i) => i !== -1);

      // Crear nuevas filas solo con datos visibles y formatedatos
      const filteredRows = tab.csvRows.map((row) =>
        visibleIndices
          .map((idx) => this.formatCsvExportCell(row[idx]))
          .join(","),
      );

      // Unir header y filas
      const csvContent = [visibleCols.join(","), ...filteredRows].join("\n");

      // Convertir a DataURI
      dataToDownload = `data:text/csv;base64,${btoa(unescape(encodeURIComponent(csvContent)))}`;
      console.log("✅ [Alchemy] CSV regenerado con éxito.");
    }

    // If Protected (SSE), forceSSE = true. Else false.
    const forceSSE = !!tab.isProtected;
    await this.downloadService.handleDownload(
      finalFileName,
      dataToDownload,
      "1234",
      forceSSE,
    );
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
      const base64Clean = tab.blobData.split(",")[1];

      // Invoke Rust Command
      // Signature: fn print_pdf_direct(pdf_base64: String, job_title: Option<String>)
      await invoke("print_pdf_direct", {
        pdfBase64: base64Clean,
        jobTitle: tab.name || "SandraDocument.pdf",
      });

      this.snapService.show("Enviado a impresora", undefined, "success");
    } catch (e) {
      console.error("Print Error:", e);
      this.showModal("Error de Impresión", "" + e);
    }
  }

  async handleIframeDownload(fileName: string, dataUri: string) {
    try {
      console.log(
        "📥 [Bridge -> DownloadService] Delegando descarga:",
        fileName,
      );
      const success = await this.downloadService.handleDownload(
        fileName,
        dataUri,
        "1234",
        false,
      );

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
    const isDevToolsShortcut =
      (event.key.toLowerCase() === "i" &&
        ((event.ctrlKey && event.shiftKey) ||
          (event.metaKey && event.shiftKey) ||
          (event.metaKey && event.altKey))) ||
      event.key === "F12";

    if (isDevToolsShortcut) {
      event.preventDefault();
      this.openDevToolsAccess();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
      event.preventDefault();

      // Desactivar el inspector (Ctrl+D / Cmd+D) en las páginas estáticas
      const staticTabs = [
        "dashboard",
        "connections",
        "apps",
        "security",
        "monitor",
        "secure-viewer",
      ];

      if (staticTabs.includes(this.currentTabId)) {
        return; // Ignorar el atajo en estas áreas
      }

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
        window.dispatchEvent(new CustomEvent("request-inspector-close"));
      }
    }
  }

  showSaveLogModal = false;
  tabIdToClose: string | null = null;

  toggleCsvSearch() {
    this.showCsvSearch = !this.showCsvSearch;
    this.showColumnSelector = false; // Close other panel
    if (!this.showCsvSearch) {
      this.csvSearchQuery = "";
      const tabs = this.appState.getTabsSnapshot();
      tabs.forEach((t) => {
        if (t.type === "csv-viewer") t.csvFilteredRows = undefined;
      });
    }
  }

  showColumnSelector = false;
  toggleColumnSelector() {
    this.showColumnSelector = !this.showColumnSelector;
    this.showCsvSearch = false; // Close other panel
  }

  toggleTxtSearch() {
    this.showTxtSearch = !this.showTxtSearch;
    if (!this.showTxtSearch) {
      this.txtSearchQuery = "";
      const tabs = this.appState.getTabsSnapshot();
      tabs.forEach((t) => {
        if (t.mimeType === "text/plain") {
          t.txtFilteredContent = undefined;
          if (t.txtLines) {
            t.txtTotalLines = t.txtLines.length;
            t.txtIsTruncated = t.txtLines.length > 1000;
          }
        }
      });
    }
  }

  formatCsvCell(cell: string): string {
    if (!cell) return cell;

    // Check if it matches ISO date like 1997-07-05T00:00:00Z
    const isoDateRegex =
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/;
    const match = cell.match(isoDateRegex);

    if (match) {
      const year = match[1];
      const month = match[2];
      const day = match[3];
      const hour = match[4];
      const minute = match[5];
      const second = match[6];

      // If time is 00:00:00, just return DD/MM/YYYY
      if (hour === "00" && minute === "00" && second === "00") {
        return `${day}/${month}/${year}`;
      } else {
        return `${day}/${month}/${year} ${hour}:${minute}:${second}`;
      }
    }

    // Check standard YYYY-MM-DD
    const dateOnlyRegex = /^(\d{4})-(\d{2})-(\d{2})$/;
    const matchDateOnly = cell.match(dateOnlyRegex);
    if (matchDateOnly) {
      return `${matchDateOnly[3]}/${matchDateOnly[2]}/${matchDateOnly[1]}`;
    }

    return cell;
  }

  formatCsvExportCell(cell: string): string {
    if (!cell) return cell;

    // ISO date YYYY-MM-DDTHH:mm:ssZ
    const isoDateRegex =
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/;
    const match = cell.match(isoDateRegex);

    if (match) {
      const year = match[1];
      const month = match[2];
      const day = match[3];
      const hour = match[4];
      const minute = match[5];
      const second = match[6];

      if (hour === "00" && minute === "00" && second === "00") {
        return `${year}-${month}-${day}`;
      } else {
        return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
      }
    }

    return cell;
  }

  isColumnVisible(tab: Tab, columnName: string): boolean {
    if (!tab.csvVisibleColumns) return true;
    return tab.csvVisibleColumns.includes(columnName);
  }

  toggleCsvColumn(tab: Tab, columnName: string) {
    if (!tab.csvVisibleColumns)
      tab.csvVisibleColumns = [...(tab.csvHeader || [])];

    const index = tab.csvVisibleColumns.indexOf(columnName);
    if (index > -1) {
      // Don't allow hiding all columns
      if (tab.csvVisibleColumns.length > 1) {
        tab.csvVisibleColumns.splice(index, 1);
      }
    } else {
      tab.csvVisibleColumns.push(columnName);
    }
  }

  showAllColumns(tab: Tab) {
    if (!tab.csvHeader) return;
    tab.csvVisibleColumns = [...tab.csvHeader];
  }

  hideAllColumns(tab: Tab) {
    if (!tab.csvHeader || tab.csvHeader.length === 0) return;
    // Keep at least the first column to avoid empty state
    tab.csvVisibleColumns = [tab.csvHeader[0]];
  }

  onCsvSearch(tab: Tab) {
    // Al usar Subject + debounceTime, la UI no se bloquea mientras el usuario escribe
    this.csvSearchSubject.next(tab);
  }

  executeCsvSearch(tab: Tab) {
    if (!tab.csvRows) return;
    const query = this.csvSearchQuery.trim().toLowerCase();

    if (!query) {
      tab.csvFilteredRows = undefined;
      return;
    }

    const terms = query.split(/\s+/).filter((t) => t.length > 0);
    if (terms.length === 0) {
      tab.csvFilteredRows = undefined;
      return;
    }

    // Si el archivo es grande (> 5000 filas), mostramos loading para dar feedback visual
    const isLargeFile = tab.csvRows.length > 5000;
    if (isLargeFile)
      this.appState.setGlobalLoading(true, "Filtrando registros...");

    // Usamos micro-task para no bloquear el frame actual y permitir que el loading se pinte
    setTimeout(
      () => {
        try {
          // OPTIMIZACIÓN: Usamos el cache pre-calculado si existe
          if (tab.csvSearchCache && tab.csvRows) {
            tab.csvFilteredRows = tab.csvRows.filter((_, index) => {
              const rowContent = tab.csvSearchCache![index];
              return terms.every((term) => rowContent.includes(term));
            });
          } else {
            // Fallback por si no se generó el cache
            tab.csvFilteredRows = tab.csvRows!.filter((row) => {
              const rowContent = row.join(" ").toLowerCase();
              return terms.every((term) => rowContent.includes(term));
            });
          }
        } finally {
          if (isLargeFile) this.appState.setGlobalLoading(false);
        }
      },
      isLargeFile ? 100 : 0,
    );
  }

  onTxtSearch(tab: Tab) {
    this.txtSearchSubject.next(tab);
  }

  executeTxtSearch(tab: Tab) {
    if (!tab.txtLines) return;
    const query = this.txtSearchQuery.trim().toLowerCase();

    if (!query) {
      // Reset full view layout to original
      const isOriginalLarge = tab.txtLines.length > 1000;
      tab.txtIsTruncated = isOriginalLarge;
      tab.txtTotalLines = tab.txtLines.length;
      tab.txtFilteredContent = undefined; // Esto hace que el HTML use txtContent (el primero pre-renderizado de <= 1000 lineas o el completo si es corto)
      return;
    }

    const isLargeFile = tab.txtLines.length > 1000;
    if (isLargeFile)
      this.appState.setGlobalLoading(true, "Buscando en documento completo...");

    setTimeout(
      () => {
        this.zone.run(() => {
          try {
            const filteredLines = tab.txtLines!.filter((line) =>
              line.toLowerCase().includes(query),
            );
            tab.txtTotalLines = filteredLines.length;

            if (filteredLines.length > 1000) {
              tab.txtIsTruncated = true;
              tab.txtFilteredContent =
                filteredLines.slice(0, 1000).join("\n") +
                `\n\n--- [INFO] Se encontraron ${filteredLines.length} coincidencias. Mostrando solo las primeras 1000 para optimizar rendimiento. ---`;
            } else {
              tab.txtIsTruncated = false;
              tab.txtFilteredContent = filteredLines.join("\n");
            }
          } finally {
            if (isLargeFile) this.appState.setGlobalLoading(false);
          }
        });
      },
      isLargeFile ? 100 : 0,
    );
  }

  /**
   * Calcula el total acumulado de una columna numérica al hacer doble clic.
   * Si detecta texto en lugar de números, avisa al usuario y pone el total a 0.
   */
  calculateColumnTotal(tab: Tab, columnName: string) {
    if (!tab.csvHeader || !tab.csvRows) return;

    this.appState.setGlobalLoading(true, "Calculando total...");

    // Timeout para permitir que el DOM se actualice y muestre el cargando
    setTimeout(() => {
      try {
        const colIndex = tab.csvHeader!.indexOf(columnName);
        if (colIndex === -1) return;

        let total = 0;
        let hasStrings = false;

        // Utilizamos las filas filtradas si existen, si no las originales.
        const rowsToProcess = tab.csvFilteredRows || tab.csvRows!;

        for (const row of rowsToProcess) {
          const val = row[colIndex];
          if (val === undefined || val === null) continue;

          const trimmedVal = val.trim();
          if (trimmedVal === "") continue;

          const cleanedVal = trimmedVal.replace(/,/g, "");
          const num = parseFloat(cleanedVal);

          if (isNaN(num)) {
            hasStrings = true;
            break;
          }
          total += num;
        }

        if (hasStrings) {
          this.showModal(
            "Análisis de Columna",
            `<span class="sub-text" style="margin-top: -15px;">Columna: <span style="color:#475569; font-weight:700">${columnName}</span></span><div style="margin-top: 25px; display: flex; flex-direction: column; gap: 8px; text-align: left; padding: 0 10px;"><div class="custom-input-group"><div class="input-group-prepend"><span class="input-group-text"><i class="fas fa-exclamation-triangle"></i></span></div><div class="input-label">Estado del Análisis</div><div class="input-value error">Error de Formato</div></div><div style="padding: 10px; font-size: 0.82rem; color: #94a3b8; text-align: center; background: #fef2f2; border-radius: 8px; border: 1px solid #fee2e2;">La columna contiene datos no numéricos.</div></div>`,
            "error",
          );
        } else {
          const formattedTotal = new Intl.NumberFormat("es-VE", {
            style: "currency",
            currency: "VES",
          }).format(total);

          const count = rowsToProcess.length;
          this.showModal(
            `${columnName}`,
            `<div style="margin-top: 25px; display: flex; flex-direction: column; gap: 10px; text-align: left; padding: 0 10px;"><div class="custom-input-group"><div class="input-group-prepend"></div><div class="input-label">Total Acumulado</div><div class="input-value success">${formattedTotal.replace("Bs.", "Bs.")}</div></div><div class="custom-input-group"><div class="input-group-prepend"><br><br></div><div class="input-label">Registros Procesados</div><div class="input-value">${count.toLocaleString("es-VE")}</div></div></div>`,
            "info",
            "fa-calculator",
          );
        }
      } finally {
        this.appState.setGlobalLoading(false);
      }
    }, 100);
  }

  async closeTab(tabId: string, evt: Event) {
    evt.stopPropagation();

    if (this.activeNativeWebviews[tabId]) {
      console.log(
        `🗑️ [Native Webview] Limpiando cache y destruyendo webview para: ${tabId}`,
      );
      try {
        await this.activeNativeWebviews[tabId].clearAllBrowsingData();
        await this.activeNativeWebviews[tabId].close();
      } catch (e) {
        console.error("Error al cerrar/limpiar webview nativo:", e);
      }
      delete this.activeNativeWebviews[tabId];
    }
    evt.preventDefault();

    if (this.logger.hasXhrLogsForApp(tabId)) {
      this.tabIdToClose = tabId;
      this.showSaveLogModal = true;
      return;
    }

    // Limpiar logs temporales (memoria y DB)
    await this.logger.clearLogs(tabId);

    // Intelligence for returning to previous context
    const tabs = this.appState.getTabsSnapshot();
    const closingTab = tabs.find((t) => t.id === tabId);

    if (closingTab && this.currentTabId === tabId) {
      if (closingTab.source === "MANUALS") {
        this.appState.setActiveTab("secure-viewer");
      }
    }

    this.appState.closeTab(tabId);
  }

  selectTab(tabId: string) {
    this.handleNavigationRequest(tabId);
  }

  handleChatToggle(isOpen: boolean) {
    this.isChatOpen = isOpen;
    this.syncNativeWebviews();
  }

  isCurrentTabExternalMode(): boolean {
    return !!(
      this.currentTabId &&
      this.activeNativeWebviews[this.currentTabId.toString()]
    );
  }

  isCurrentTabDynamic(): boolean {
    const staticTabs = [
      "dashboard",
      "connections",
      "security",
      "monitor",
      "proyectos",
      "apps",
      "secure-viewer",
    ];
    return !!(
      this.currentTabId && !staticTabs.includes(this.currentTabId.toString())
    );
  }

  setupResizeObserver(placeholder: HTMLElement) {
    if (this.activePlaceholderId === placeholder.id) return;

    this.disconnectResizeObserver();

    this.activePlaceholderId = placeholder.id;
    this.resizeObserver = new ResizeObserver(() => {
      this.zone.run(() => {
        this.syncNativeWebviews();
      });
    });

    this.resizeObserver.observe(placeholder);
  }

  disconnectResizeObserver() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = undefined;
      this.activePlaceholderId = null;
    }
  }

  syncWebviewDuringTransition() {
    if (this.transitionInterval) {
      clearInterval(this.transitionInterval);
    }

    const startTime = Date.now();
    const duration = 400; // 300ms CSS + 100ms extra settle room

    this.transitionInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      if (elapsed >= duration) {
        clearInterval(this.transitionInterval);
        this.transitionInterval = null;
      }
      this.syncNativeWebviews();
    }, 16); // ~60fps smooth glide
  }

  async confirmCloseTab(shouldSave: boolean) {
    if (this.tabIdToClose) {
      if (shouldSave) {
        await this.logger.saveAllLogs(this.tabIdToClose);
      } else {
        await this.logger.clearLogs(this.tabIdToClose);
      }

      // Limpiar webview nativo si existe
      if (this.activeNativeWebviews[this.tabIdToClose]) {
        console.log(
          `🗑️ [Native Webview] Limpiando cache y destruyendo webview para: ${this.tabIdToClose}`,
        );
        try {
          await this.activeNativeWebviews[
            this.tabIdToClose
          ].clearAllBrowsingData();
          await this.activeNativeWebviews[this.tabIdToClose].close();
        } catch (e) {
          console.error("Error al cerrar/limpiar webview nativo:", e);
        }
        delete this.activeNativeWebviews[this.tabIdToClose];
      }

      // Intelligence for returning to previous context
      const tabs = this.appState.getTabsSnapshot();
      const closingTab = tabs.find((t) => t.id === this.tabIdToClose);
      if (closingTab && this.currentTabId === this.tabIdToClose) {
        if (closingTab.source === "MANUALS") {
          this.appState.setActiveTab("secure-viewer");
        }
      }

      this.appState.closeTab(this.tabIdToClose);
    }
    this.showSaveLogModal = false;
    this.tabIdToClose = null;
  }

  cancelCloseTab() {
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
    const iframeExtId = "iframe-ext-" + this.currentTabId;
    const iframe = (document.getElementById(iframeId) ||
      document.getElementById(iframeExtId)) as HTMLIFrameElement;

    if (iframe) {
      console.log(`Reloading iframe: ${iframe.id}`);
      const currentSrc = iframe.src;
      iframe.src = currentSrc;
    } else {
      console.warn(
        `Iframe not found for reloading: ${iframeId} or ${iframeExtId}`,
      );
    }
  }

  onIframeLoad(tabId: string) {
    // console.log(`[Iframe Loaded] Sending context to ${tabId}`);
    this.sendContextToIframe(tabId);
  }

  sendContextToIframe(tabId: string) {
    const iframeId = "iframe-" + tabId;
    const iframeExtId = "iframe-ext-" + tabId;
    const iframe = (document.getElementById(iframeId) ||
      document.getElementById(iframeExtId)) as HTMLIFrameElement;

    if (iframe && iframe.contentWindow) {
      const targetOrigin =
        iframe.src && iframe.src.startsWith("http")
          ? new URL(iframe.src).origin
          : "*";

      // 1. Enviar Contexto de Red y Sistema
      const contextPayload = {
        system: this.stats,
        network: { ips: this.networkInfo },
        config: { clientId: this.clientId },
        timestamp: new Date().toISOString(),
      };

      iframe.contentWindow.postMessage(
        {
          type: "NETWORK_CONTEXT",
          payload: contextPayload,
        },
        targetOrigin,
      );

      // 2. Enviar Sesión JWT (SET_SESSION) si está habilitada
      const token = this.getJwtToken();
      if (token) {
        // console.log(`[PostMessage] Enviando SET_SESSION a ${tabId}`);
        iframe.contentWindow.postMessage(
          {
            type: "SET_SESSION",
            token: token,
          },
          targetOrigin,
        );
      }

      // 3. Notificar Tareas Finalizadas (Si existen para esta APP)
      const tasks = this.appState.getTasksSnapshot();
      const completedTasks = tasks.filter(
        (t) => t.appId === tabId && t.status === "finalizado",
      );

      completedTasks.forEach((task) => {
        console.log(
          `[PostMessage] Re-enviando finalización de tarea ${task.id} a ${tabId}`,
        );
        iframe.contentWindow!.postMessage(
          {
            type: "EXEC_FNX_FINALIZADO",
            payload: {
              appId: task.appId,
              taskId: task.id,
              data: task.logs?.join("\n") || task.payload,
            },
          },
          targetOrigin,
        );
      });
    }
  }
  private async setupBackgroundTaskListener() {
    this.backgroundTaskUnlisten = await listen(
      "background-task-event",
      (event: any) => {
        this.zone.run(() => {
          const payload = event.payload;
          if (
            payload.type === "exec-fnx" &&
            (payload.from === "system" ||
              payload.from === "Ejecución de Función" ||
              !payload.from)
          ) {
            this.handleExecFnxTask(payload);
          }
          if (
            payload.type === "exec-fnx-track" &&
            (payload.from === "system" ||
              payload.from === "Ejecución de Función" ||
              !payload.from)
          ) {
            this.handleExecFnxTaskTrack(payload);
          }
        });
      },
    );
  }

  private handleExecFnxTask(payload: any) {
    const taskId = payload.id || payload.appId || "unknown-task";
    const status = payload.status as
      | "pending"
      | "running"
      | "finalizado"
      | "error";

    const task: BackgroundTask = {
      id: taskId,
      appId: payload.appId,
      title: payload.title || "Ejecución de Tarea",
      status: status,
      progress: payload.progress ?? 0,
      message: payload.message,
      payload: payload.payload, // Full document details
      timestamp: new Date(),
    };

    // Agregar o actualizar en el servicio
    this.appState.addTask(task);
    this.appState.updateTask(taskId, task);

    // Si está finalizado, notificar a la app hija

    if (status === "finalizado") {
      // Recuperar la tarea completa con todos los logs acumulados
      const fullTask = this.appState
        .getTasksSnapshot()
        .find((t) => t.id === taskId);
      // Si el backend envía el bloque final en payload.payload (o message), lo usamos.
      // Si no, recurrimos a los logs acumulados.
      const accumulatedLogs =
        payload.payload || payload.message || fullTask?.logs?.join("\n");

      this.notifyExecFnxCompletion(payload, accumulatedLogs);

      // Auto-remover de la UI tras 5 segundos
      setTimeout(() => {
        this.appState.removeTask(taskId);
      }, 5000);
    }
  }

  private handleExecFnxTaskTrack(payload: any) {
    const taskId = payload.id || payload.appId || "unknown-task";
    const status = payload.status as
      | "pending"
      | "running"
      | "finalizado"
      | "error";

    const task: BackgroundTask = {
      id: taskId,
      appId: payload.appId,
      title: payload.title || "Ejecución de Tarea",
      status: status,
      progress: payload.progress ?? 0,
      message: payload.message,
      payload: payload.payload,
      timestamp: new Date(),
      type: payload.type,
    };

    this.appState.addTask(task);
    this.appState.updateTask(taskId, task);

    if (status === "finalizado") {
      const fullTask = this.appState
        .getTasksSnapshot()
        .find((t) => t.id === taskId);
      const accumulatedLogs =
        payload.payload || payload.message || fullTask?.logs?.join("\n");

      this.notifyExecFnxCompletion(payload, accumulatedLogs);

      setTimeout(() => {
        this.appState.removeTask(taskId);
      }, 2000);
    }
  }

  private notifyExecFnxCompletion(payload: any, data: any) {
    const appId = payload.appId;
    if (!appId) return;

    const normalizedId = String(appId).toLowerCase();

    // Resolver la pestaña correcta comparando tanto appId de texto como el id numérico
    const tabs = this.appState.getTabsSnapshot();
    const tab = tabs.find(
      (t) =>
        t.appId?.toLowerCase() === normalizedId ||
        t.id?.toString().toLowerCase() === normalizedId,
    );
    const resolvedTabId = tab ? tab.id : appId;

    const port = this.authPorts.get(resolvedTabId.toString().toLowerCase());
    const completionMsg = {
      type: "EXEC_FNX_FINALIZADO",
      payload: {
        appId: appId,
        taskId: payload.id,
        data: data,
      },
    };

    if (port) {
      console.log(
        `🔌 [Bridge] Re-enviando EXEC_FNX_FINALIZADO vía MessagePort para Tab: ${resolvedTabId}`,
      );
      port.postMessage(completionMsg);
    } else {
      // Buscar el iframe usando el ID numérico correcto del Tab
      const iframeId = "iframe-" + resolvedTabId;
      const iframeExtId = "iframe-ext-" + resolvedTabId;
      const iframe = (document.getElementById(iframeId) ||
        document.getElementById(iframeExtId)) as HTMLIFrameElement;

      if (iframe && iframe.contentWindow) {
        console.log(
          `📡 [Bridge] Re-enviando EXEC_FNX_FINALIZADO vía IFrame postMessage para Tab: ${resolvedTabId}`,
        );
        iframe.contentWindow.postMessage(completionMsg, "*");
      } else {
        // Fallback a broadcast global (menos recomendado pero útil como último recurso)
        console.warn(
          `⚠️ [Bridge] IFrame no encontrado para ${resolvedTabId}. Usando fallback postMessage.`,
        );
        window.postMessage(completionMsg, "*");
      }
    }
  }

  async handleStartDownload(data: any) {
    if (!data.id || !data.trackingId) {
      console.error("Faltan parámetros en START_DOWNLOAD", data);
      return;
    }

    if (!this.activeConnection) {
      this.showModal("Error", "No hay una conexión activa para descargar.");
      return;
    }

    const tabIdInitiated = this.currentTabId; // Capturar la pestaña activa que inició la descarga

    const taskId = `dl_${data.id}_${data.trackingId}`;
    const task: BackgroundTask = {
      id: taskId,
      title: `Descarga: ${data.id}`,
      status: "running",
      progress: 0,
      message: "Iniciando conexión segura...",
      timestamp: new Date(),
    };

    this.appState.addHttpTask(task);

    // Escuchar progreso desde Rust (Canal dedicado HTTP)
    const unlisten = await listen("secure-download-progress", (event: any) => {
      if (event.payload.id === taskId) {
        this.zone.run(() => {
          this.appState.updateHttpTask(taskId, {
            progress: event.payload.progress,
            message: event.payload.message,
            status: event.payload.status,
          });
        });
      }
    });

    try {
      const resultPath = await invoke<string>("procesar_descarga_segura", {
        idNomina: data.id,
        trackingId: data.trackingId,
        ip: this.activeConnection.ip_address,
        port: Number(this.activeConnection.port),
        hash: this.activeConnection.hash || "",
        tempAuthToken: this.activeConnection.jwt || null,
      });

      this.snapService.show("Descarga Finalizada", undefined, "success");
      console.log("Archivos guardados en:", resultPath);

      // Notificar a la app hija si es necesario
      this.notifyDownloadCompletion(data, resultPath, tabIdInitiated);
    } catch (error: any) {
      console.error("Error en descarga segura:", error);
      this.appState.updateHttpTask(taskId, {
        status: "error",
        message:
          typeof error === "string"
            ? error
            : error.message || "Error desconocido",
      });
      this.showModal(
        "Error de Descarga",
        typeof error === "string"
          ? error
          : "Ocurrió un error al procesar la descarga.",
      );
    } finally {
      unlisten();
    }
  }

  private notifyDownloadCompletion(
    originalData: any,
    path: string,
    tabIdInitiated?: any,
  ) {
    const appId =
      tabIdInitiated !== undefined && tabIdInitiated !== null
        ? tabIdInitiated
        : originalData.id;
    if (appId === undefined || appId === null) return;

    const normalizedId = String(appId).toLowerCase();
    const port = this.authPorts.get(normalizedId);
    const completionMsg = {
      type: "DOWNLOAD_FINISHED",
      payload: {
        id_nomina: originalData.id_nomina || originalData.id,
        trackingId: originalData.trackingId,
        path: path,
      },
    };

    if (port) {
      console.log(
        `🔌 [Bridge] Re-enviando DOWNLOAD_FINISHED vía MessagePort para Tab: ${appId}`,
      );
      port.postMessage(completionMsg);
    } else {
      const iframeId = "iframe-" + appId;
      const iframe = document.getElementById(iframeId) as HTMLIFrameElement;
      if (iframe && iframe.contentWindow) {
        console.log(
          `📡 [Bridge] Re-enviando DOWNLOAD_FINISHED vía IFrame postMessage para Tab: ${appId}`,
        );
        iframe.contentWindow.postMessage(completionMsg, "*");
      } else {
        console.warn(
          `⚠️ [Bridge] IFrame no encontrado para DOWNLOAD_FINISHED: ${iframeId}. Re-enviando vía broadcast global.`,
        );
        window.postMessage(completionMsg, "*");
      }
    }
  }

  isAnyOverlayVisible(): boolean {
    return (
      this.showLoginModal ||
      (this.installModal && this.installModal.show) ||
      (this.confirmModal && this.confirmModal.show) ||
      this.showDbModal ||
      (this.genericModal && this.genericModal.show) ||
      (this.exitModal && this.exitModal.show) ||
      (this.questionModal && this.questionModal.show) ||
      this.showJwtSetupModal ||
      this.showControlPanel ||
      this.isChatOpen ||
      this.showUnlockTabModal ||
      this.showSaveLogModal ||
      this.showSetupWizard
    );
  }

  ngDoCheck() {
    const overlayState = this.isAnyOverlayVisible();
    if (overlayState !== this.lastOverlayState) {
      this.lastOverlayState = overlayState;
      // console.log(
      //   `👁️ [Overlay State] Cambió a: ${overlayState ? "Visible" : "Oculto"}. Sincronizando webviews...`,
      // );
      // Retraso mínimo para asegurar que los elementos del DOM estén estables antes de sincronizar
      setTimeout(() => this.syncNativeWebviews(), 50);
    }
  }

  syncNativeWebviews() {
    const isMac = window.navigator.userAgent.includes("Mac");
    const dpr = window.devicePixelRatio || 1;
    // Usamos LogicalSize y LogicalPosition que esperan píxeles lógicos.
    // Tauri maneja la escala DPR automáticamente a nivel nativo en todas las plataformas,
    // por lo que no debemos multiplicar manualmente por el factor de escala (evita doble escalado en macOS).
    const scaleFactor = 1;
    const hasOverlay = this.isAnyOverlayVisible();

    // console.log(
    //   `🔄 [Native Webview] Sincronizando... currentTabId: ${this.currentTabId} | Overlays: ${hasOverlay} | OS: ${isMac ? "macOS" : "Otros"} | DPR: ${dpr} | Factor Escala: ${scaleFactor}`,
    // );

    Object.keys(this.activeNativeWebviews).forEach((tabId) => {
      const webview = this.activeNativeWebviews[tabId];
      if (!webview) return;

      // El webview solo es visible si es la pestaña activa y NO hay ningún modal u overlay abierto
      const isVisible =
        this.currentTabId &&
        this.currentTabId.toString() === tabId &&
        !hasOverlay;

      if (isVisible) {
        const placeholderId = `webview-placeholder-${tabId}`;
        const placeholder = document.getElementById(placeholderId);
        if (placeholder) {
          this.setupResizeObserver(placeholder);

          const rect = placeholder.getBoundingClientRect();

          if (rect.width > 0 && rect.height > 0) {
            import("@tauri-apps/api/dpi").then(
              ({ LogicalSize, LogicalPosition }) => {
                // Para Native Webview, ignoramos banners (quedan por debajo del renderizado nativo de Tauri)
                // Ajustamos la posición +26px para bajarlo al punto ideal
                const adjustedTop = Math.floor(rect.top) + 29;

                // Medición ultra-segura para llegar hasta el borde inferior y completar dimensiones
                const heightFromWindow = window.innerHeight - adjustedTop;
                const adjustedHeight = heightFromWindow + 30; // Extra padding para completar el bottom

                const targetWidth = Math.ceil(rect.width * scaleFactor) + 15; // Extra padding para completar el ancho
                const targetHeight = Math.ceil(adjustedHeight * scaleFactor);
                const targetX = Math.floor(rect.left * scaleFactor);
                const targetY = Math.floor(adjustedTop * scaleFactor);

                console.log(
                  `  📐 Medidas Angular: ${rect.width}x${rect.height} en (${rect.left}, ${rect.top})`,
                );
                console.log(
                  `  🚀 Enviando a Tauri: ${targetWidth}x${targetHeight} en (${targetX}, ${targetY})`,
                );

                webview
                  .setSize(new LogicalSize(targetWidth, targetHeight))
                  .catch((e) => console.error("Error setSize:", e));

                webview
                  .setPosition(new LogicalPosition(targetX, targetY))
                  .catch((e) => console.error("Error setPosition:", e));

                webview.show().catch((e) => console.error("Error show:", e));
              },
            );
          } else {
            webview.hide();
          }
        } else {
          this.disconnectResizeObserver();
          webview.hide();
        }
      } else {
        if (this.currentTabId && this.currentTabId.toString() === tabId) {
          this.disconnectResizeObserver();
        }
        webview.hide();
      }
    });
  }

  openQuickDiagnostics(tab: any) {
    // console.log("🔍 Quick diagnostics requested for tab:", tab);

    // 1. Mostrar el panel de configuración
    this.showControlPanel = true;
    this.loadNetwork();

    // 2. Esperar a que se renderice el componente e invocar el test
    setTimeout(async () => {
      if (this.configComponent) {
        this.configComponent.activeConfigTab = "network";

        let target = tab.url;
        if (
          target &&
          typeof target === "object" &&
          (target as any).changingThisBreaksApplicationSecurity
        ) {
          target = (target as any).changingThisBreaksApplicationSecurity;
        }

        if (target && typeof target === "string") {
          if (
            target.includes("/bypass-proxy/") ||
            target.includes("localhost/pace/")
          ) {
            this.configComponent.diagnosticsTargetUrl =
              "http://pace.ipsfa.gob.ve:8080/pace/";
          } else {
            this.configComponent.diagnosticsTargetUrl = target;
          }
        }

        await this.configComponent.testNetworkConnection();
      }
    }, 150);
  }

  async handleIdentityUpdate() {
    // console.log("🔄 [App] Actualizando identidad del sistema...");
    try {
      const setupStatus = await invoke<any>("get_setup_status");
      if (setupStatus.machine_name) {
        this.zone.run(() => {
          const name = setupStatus.machine_name;
          const parts = name.split(/[-_]/);
          if (parts.length > 1) {
            this.machineNameMain = parts[0];
            this.machineNameSuffix = parts.slice(1).join("-");
          } else {
            this.machineNameMain = name;
            this.machineNameSuffix = "";
          }
          this.machineArea = setupStatus.machine_area || "";
          this.machineDescription = setupStatus.machine_description || "";
        });
      }

      if (this.activeConnection) {
        this.snapService.show(
          "Identidad Actualizada",
          { clientX: window.innerWidth / 2, clientY: 50 } as any,
          "info",
          "fa-sync",
        );
        await this.sdcService.disconnectFromServer(
          this.activeConnection,
          this.clientId,
        );
        await this.zone.run(async () => {
          await this.performLocalLogout();
        });
        await this.loadConnections();
        setTimeout(() => {
          this.snapService.show(
            "Por favor, reconecte para aplicar los cambios",
            { clientX: window.innerWidth / 2, clientY: 50 } as any,
            "warning",
            "fa-plug",
          );
        }, 1500);
      } else {
        this.snapService.show(
          "Identidad Actualizada",
          { clientX: window.innerWidth / 2, clientY: 50 } as any,
          "success",
          "fa-check",
        );
      }
    } catch (e) {
      console.error("Error al refrescar identidad", e);
    }
  }

  toggleMachinePopover(event: MouseEvent) {
    event.stopPropagation();
    this.showMachinePopover = !this.showMachinePopover;
    if (this.showMachinePopover) {
      // Close popover when clicking outside
      const closePopover = () => {
        this.zone.run(() => {
          this.showMachinePopover = false;
        });
        document.removeEventListener("click", closePopover);
      };
      setTimeout(() => document.addEventListener("click", closePopover), 0);
    }
  }

  // --- JWT SESSION TIMER ---
  startJwtSessionTimer() {
    if (this.jwtTimerInterval) {
      clearInterval(this.jwtTimerInterval);
    }

    this.jwtTimerInterval = setInterval(() => {
      this.zone.run(() => {
        const token = this.getJwtToken();

        // Si teníamos un usuario de sesión pero ya no hay token válido, la sesión ha expirado
        if (this.sessionUsername && !token) {
          // console.warn(
          //   "🔐 [System] Sesión expirada detectada (teníamos usuario pero no hay token válido). Cerrando sesión...",
          // );
          this.handleSessionExpiration();
          return;
        }

        if (token) {
          try {
            const payload = this.utils.decodeJwt(token);
            if (payload) {
              // Username and Extracted Details
              if (payload.Usuario) {
                this.sessionUsername =
                  payload.Usuario.usuario || payload.sub || payload.name || "";
                this.jwtNombre = payload.Usuario.nombre || this.sessionUsername;
                this.jwtCargo =
                  payload.Usuario.cargo || payload.Usuario.Perfil?.nombre || "";
                this.jwtDescripcion = payload.Usuario.descripcion || "";
              } else if (payload.sub || payload.name) {
                this.sessionUsername = payload.sub || payload.name;
                this.jwtNombre = this.sessionUsername;
              }

              // Calcular tiempo restante basado en 'exp' y la FirmaDigital por si exp falla
              let expTime = 0;
              if (payload.exp) {
                expTime = payload.exp * 1000;
              } else if (
                payload.FirmaDigital?.tiempo &&
                payload.FirmaDigital?.duracion
              ) {
                const start = new Date(payload.FirmaDigital.tiempo).getTime();
                expTime = start + payload.FirmaDigital.duracion * 60 * 1000; // asumiendo que duracion son minutos, el exp deberia venir
              }

              if (expTime > 0) {
                const now = Date.now();
                const diffSeconds = Math.floor((expTime - now) / 1000);

                if (diffSeconds > 0) {
                  this.sessionSecondsLeft = diffSeconds;
                  const h = Math.floor(diffSeconds / 3600);
                  const m = Math.floor((diffSeconds % 3600) / 60);
                  const s = diffSeconds % 60;

                  if (h > 0) {
                    this.sessionTimeRemaining = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
                  } else {
                    this.sessionTimeRemaining = `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
                  }

                  // Notificación de advertencia 5 segundos antes
                  if (
                    diffSeconds <= 5 &&
                    diffSeconds > 0 &&
                    !this.jwtWarningShown
                  ) {
                    this.jwtWarningShown = true;
                    this.snapService.show(
                      `La sesión expirará en ${diffSeconds} segundos`,
                      undefined,
                      "warning",
                      "fa-clock",
                    );
                  }
                } else {
                  this.sessionTimeRemaining = "00:00";
                  this.sessionSecondsLeft = 0;
                  // console.warn(
                  //   "🔐 [System] Tiempo de token agotado en contador. Cerrando sesión...",
                  // );
                  this.handleSessionExpiration();
                }
              }
            }
          } catch (e) {}
        } else {
          this.sessionTimeRemaining = "";
          this.sessionSecondsLeft = 0;
          this.sessionUsername = "";
          this.jwtWarningShown = false;
        }
      });
    }, 1000);
  }
}
