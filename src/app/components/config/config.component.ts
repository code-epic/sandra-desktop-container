import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy, ChangeDetectorRef, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl } from '@angular/forms';
import { POLICIES_HTML } from '../../constants/policies';
import { PerformanceService, PerformanceProfile } from '../../core/services/performance.service';
import { UpdateService } from '../../core/services/update.service';
import { UtilsService } from '../../core/services/utils.service';
import { SecurityService } from '../../core/services/security.service';
import { invoke } from '@tauri-apps/api/core';
import { ISandraJwtPayload } from '../../core/models/security.model';
import { SnapService } from '../../core/services/snap.service';
import { CaucionService } from '../../core/services/caucion.service';

@Component({
  selector: 'app-config',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './config.component.html',
  styleUrls: ['./config.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConfigComponent implements OnInit {
  @Input() config: any;
  @Input() networkInfo: string[] = [];
  @Input() availableConnections: any[] = [];
  @Input() activeConnection: any;
  @Input() wsStatus: string = 'Desconectado';
  @Input() isLoggedIn: boolean = false;

  @Output() close = new EventEmitter<void>();
  @Output() onSave = new EventEmitter<void>();
  @Output() onActivateConnection = new EventEmitter<any>();
  @Output() onDisconnect = new EventEmitter<any>();
  @Output() onLoginRequest = new EventEmitter<void>();

  activeConfigTab: string = 'logs';
  viewingPolicies: boolean = false;
  policiesHtml = POLICIES_HTML;

  perfOptions = [
    { label: 'Automático (Recomendado)', value: 'auto' },
    { label: 'Ecosistema (Gráficos Full)', value: PerformanceProfile.HIGH },
    { label: 'Fluidez (Modo Legado)', value: PerformanceProfile.LOW }
  ];

  selectedPerfMode: string = 'auto';

  // --- Seguridad y Cambio de Clave ---
  changePasswordForm!: FormGroup;
  showClave = false;
  showNueva = false;
  showRepite = false;
  passwordStrengthLabel: string = 'Sin seguridad';
  passwordStrengthColor: string = '';
  passwordStrengthWidth: number = 0;

  // --- TOTP / QR ---
  showTotpSection: boolean = false;
  totpQrCodeUrl: string = '';
  totpSecret: string = '';
  isTotpSecretCopied: boolean = false;
  isTotpActive: boolean = false;

  // --- Diagnóstico de Red ---
  diagnosticsTargetUrl: string = 'http://pace.ipsfa.gob.ve:8080/pace/';
  diagnosing: boolean = false;
  diagnosticsReport: any = null;

  constructor(
    public performance: PerformanceService,
    public updateService: UpdateService,
    private fb: FormBuilder,
    private cdr: ChangeDetectorRef,
    private utils: UtilsService,
    private securityService: SecurityService,
    private snapService: SnapService,
    private caucionService: CaucionService
  ) {
    const saved = localStorage.getItem('sandra_perf_mode') || 'auto';
    this.selectedPerfMode = saved;
  }

  ngOnInit() {
    this.initForm();
    this.checkInitialTotpStatus();
  }

  private checkInitialTotpStatus() {
    const token = this.getJwtToken();
    if (token) {
      try {
        const payload: ISandraJwtPayload = this.utils.decodeJwt(token);
        // Si el usuario ya tiene un token TOTP vinculado
        console.log(payload);
        if (payload?.Usuario?.token && payload.Usuario.token !== '') {
          this.totpSecret = payload.Usuario.token;
          this.showTotpSection = true;
          this.activarSinEvento(false); // No cerrar automáticamente al iniciar
        }
      } catch (e) {
        console.error("Error evaluando estado inicial de TOTP:", e);
      }
    }
  }

  initForm() {
    this.changePasswordForm = this.fb.group({
      clave: ['', Validators.required],
      nueva: ['', [
        Validators.required,
        Validators.minLength(8),
        Validators.maxLength(16),
        Validators.pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,16}$/)
      ]],
      repite: ['', Validators.required]
    }, {
      validators: this.checkPasswords
    });

    this.changePasswordForm.get('nueva')?.valueChanges.subscribe((val) => {
      this.checkPasswordStrength(val);
      this.changePasswordForm.get('repite')?.updateValueAndValidity();
    });
  }

  checkPasswords(group: AbstractControl) {
    const nueva = group.get('nueva')?.value;
    const repite = group.get('repite')?.value;
    return nueva === repite ? null : { notSame: true };
  }

  checkPasswordStrength(password: string): void {
    if (!password) {
      this.passwordStrengthWidth = 0;
      this.passwordStrengthLabel = 'Sin seguridad';
      this.passwordStrengthColor = '';
      return;
    }
    const checks = [
      /.{8,}/,       // Mínimo 8 caracteres
      /[A-Z]/,       // Al menos una mayúscula
      /[a-z]/,       // Al menos una minúscula
      /[0-9]/,       // Al menos un número
      /[@$!%*?&]/    // Al menos un símbolo
    ];

    const result = checks.reduce((score, regex) => {
      return score + (regex.test(password) ? 20 : 0);
    }, 0);

    this.passwordStrengthWidth = result;

    if (result < 40) {
      this.passwordStrengthLabel = 'Débil';
      this.passwordStrengthColor = 'bg-danger';
    } else if (result < 80) {
      this.passwordStrengthLabel = 'Media';
      this.passwordStrengthColor = 'bg-warning';
    } else if (result < 100) {
      this.passwordStrengthLabel = 'Buena';
      this.passwordStrengthColor = 'bg-info';
    } else {
      this.passwordStrengthLabel = 'Fuerte';
      this.passwordStrengthColor = 'bg-success';
    }
  }

  toggleTotp(active: boolean) {
    this.isTotpActive = active;
    if (active) {
      this.generateTotp();
    } else {
      this.limpiarTotp();
    }
    this.cdr.detectChanges();
  }
  async generateTotp() {
    if (!this.activeConnection) return;
    this.showTotpSection = true;
    this.totpQrCodeUrl = '';
    this.totpSecret = '';
    this.cdr.detectChanges();

    try {
      // 1. Obtener Secreto
      const gtotpEndpoint = "v1/api/wusuario/gtotp/base64";
      const hash = this.getConnectionHash();
      const token = this.getJwtToken();

      const response: any = await invoke("api_post_request", {
        ip: this.activeConnection.ip_address,
        port: Number(this.activeConnection.port),
        endpoint: gtotpEndpoint,
        payload: {},
        hash,
        tempAuthToken: token,
      });

      if (response && response.contenido) {
        // La URL para el QR puede venir en .URL o .msj
        const totpUrl = response.msj;
        this.totpSecret = response.SecretCode || response.msj || '';

        this.totpQrCodeUrl = response.contenido.startsWith('data:image')
          ? response.contenido
          : `data:image/png;base64,${response.contenido}`;

        if (!totpUrl) {
          console.error("No se recibió URL para generar QR:", response);
        }
      }
    } catch (error) {
      console.error('Error al generar TOTP:', error);
    } finally {
      this.cdr.detectChanges();
    }
  }

  async limpiarTotp() {
    // Optimistic UI Update: Ocultar y limpiar inmediatamente para feedback instantáneo
    this.showTotpSection = false;
    this.totpQrCodeUrl = '';
    this.totpSecret = '';
    this.cdr.detectChanges();

    try {
      const hash = this.getConnectionHash();
      const token = this.getJwtToken();

      const endpoint = `v1/api/crud:${hash}`;
      const payload = {
        funcion: "_SYS_UUserTOTP",
        parametros: `,` // Enviamos vacío para limpiar
      };

      await invoke("api_post_request", {
        ip: this.activeConnection.ip_address,
        port: Number(this.activeConnection.port),
        endpoint,
        payload,
        hash,
        tempAuthToken: token,
      });

      this.snapService.show("Doble Factor Desactivado", undefined, "info", "fa-unlock");
    } catch (error) {
      console.error('Error al limpiar TOTP:', error);
      // Revertir UI si falla el backend
      this.isTotpActive = true;
      this.showTotpSection = true;
      this.cdr.detectChanges();
      this.snapService.show("Error al desactivar 2FA", undefined, "error", "fa-exclamation-triangle");
    }
  }

  /**
   * Obtiene el hash de conexión siguiendo el patrón de SecureViewer:
   * Prioriza la sesión activa en memoria y usa fallbacks de almacenamiento.
   */
  private getConnectionHash(): string {
    // 1. Prioridad: Conexión activa recibida por Input
    if (this.activeConnection?.hash) return this.activeConnection.hash;

    // 2. Fallback: Conexión activa en SecurityService (Memoria)
    const serviceConn = this.securityService.activeSyncConnection;
    if (serviceConn?.hash) return serviceConn.hash;

    // 3. Fallback: LocalStorage (Persistencia de sesión)
    const activeConnStr = localStorage.getItem('active_connection');
    if (activeConnStr) {
      try {
        const conn = JSON.parse(activeConnStr);
        if (conn.hash) return conn.hash;
      } catch (e) {
        console.warn("[Config] Error parseando active_connection de storage", e);
      }
    }

    // 4. Fallback final: Configuración UI general
    const sdcUiConfig = this.utils.getLocalJson<any>('sdc_ui_config');
    return sdcUiConfig?.connection_hash || '';
  }

  private getJwtToken(): string {
    const storage = this.config.access.jwtStorage === 'sessionStorage' ? sessionStorage : localStorage;
    return storage.getItem(this.config.access.jwtVariableName) || '';
  }

  copyTotpSecret() {
    if (!this.totpSecret) return;
    navigator.clipboard.writeText(this.totpSecret).then(() => {
      this.isTotpSecretCopied = true;
      this.cdr.detectChanges();
      setTimeout(() => {
        this.isTotpSecretCopied = false;
        this.cdr.detectChanges();
      }, 2500);
    });
  }

  async executeChangePassword() {
    if (this.changePasswordForm.invalid || !this.activeConnection) return;

    const { clave, nueva } = this.changePasswordForm.value;
    const hash = this.getConnectionHash();
    const token = this.getJwtToken();

    // Extraer el login directamente del JWT decodificado
    let login = "";
    if (token) {
      try {
        const payload: ISandraJwtPayload = this.utils.decodeJwt(token);
        login = payload?.Usuario?.usuario || "";
      } catch (e) {
        console.error("Error decodificando JWT para obtener login:", e);
      }
    }

    if (!login) {
      alert("No se pudo identificar el usuario de la sesión actual.");
      return;
    }

    try {
      // 1. Hashear contraseñas en SHA256
      const claveHash = await this.utils.sha256(clave);
      const nuevaHash = await this.utils.sha256(nueva);

      // 2. Construir payload CRUD con la función _SYS_UUserPanel
      const endpoint = `v1/api/crud:${hash}`;
      const payload = {
        funcion: "_SYS_UUserPanel",
        parametros: `${login},${claveHash},${nuevaHash}`
      };

      // 3. Invocar api_post_request
      const response: any = await invoke("api_post_request", {
        ip: this.activeConnection.ip_address,
        port: Number(this.activeConnection.port),
        endpoint,
        payload,
        hash,
        tempAuthToken: token,
      });

      const isSuccess = response && (
        response.msj === "Ok" ||
        response.status === "success" ||
        (response.MatchedCount === 1 && response.ModifiedCount === 1)
      );

      if (isSuccess) {
        this.changePasswordForm.reset();

        // Notificación elegante y cierre
        const centerEvent = { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 };
        this.snapService.show("¡Felicidades! Contraseña Actualizada", centerEvent as any, "success", "fa-lock");

        setTimeout(() => {
          this.close.emit();
        }, 800);
      } else {
        const errorMsg = response?.msj || (response?.MatchedCount === 0 ? "Usuario o clave actual incorrectos" : "No se realizaron cambios");
        throw new Error(errorMsg);
      }
    } catch (error) {
      alert('Error al cambiar contraseña: ' + error);
    }
  }



  async activarSinEvento(autoClose: boolean = true) {
    this.isTotpActive = true;
    const hash = this.getConnectionHash();
    const token = this.getJwtToken();
    try {
      // 1. Hashear contraseñas en SHA256

      // 2. Construir payload CRUD con la función _SYS_UUserPanel
      const endpoint = `v1/api/imgslocalbase64/${this.totpSecret}`;

      const payload = {}
      // 3. Invocar api_post_request
      const response: any = await invoke("api_get_request", {
        ip: this.activeConnection.ip_address,
        port: Number(this.activeConnection.port),
        endpoint,
        payload,
        hash,
        tempAuthToken: token,
      });

      const isSuccess = response && response.contenido

      if (isSuccess) {
        this.totpQrCodeUrl = response.contenido;

        if (autoClose) {
          setTimeout(() => {
            this.close.emit();
          }, 800);
        }
      }
    } catch (error) {
      alert('Error al cambiar contraseña: ' + error);
    }
  }

  checkUpdates() {
    this.updateService.checkAndPrompt();
  }

  onPerfChange() {
    this.performance.setManualProfile(this.selectedPerfMode as any);
  }

  saveConfig() {
    this.onSave.emit();
  }

  activateConnectionGlobal(conn: any) {
    this.onActivateConnection.emit(conn);
  }

  disconnect(conn: any) {
    this.onDisconnect.emit(conn);
  }

  closeModal() {
    this.close.emit();
  }

  generateCaucion() {
    const token = this.getJwtToken();
    if (!token) {
      this.snapService.show('Error: Sesión no válida. No se puede generar la caución.', undefined, 'error', 'fa-times-circle');
      return;
    }
    this.caucionService.generarCaucionPdf(token);
    this.closeModal(); // Opcional: Cerrar el modal después de generarla
  }

  async testNetworkConnection() {
    if (!this.diagnosticsTargetUrl) return;
    this.diagnosing = true;
    this.diagnosticsReport = null;
    this.cdr.detectChanges();

    try {
      this.diagnosticsReport = await invoke("run_network_diagnostics", {
        targetUrl: this.diagnosticsTargetUrl
      });
      console.log("Diagnostics report received:", this.diagnosticsReport);
    } catch (e) {
      console.error("Diagnostics failed:", e);
      this.diagnosticsReport = {
        target_url: this.diagnosticsTargetUrl,
        parsed_domain: '',
        parsed_port: 0,
        dns_ips: [],
        tcp_connected: false,
        http_status: null,
        http_headers: {},
        steps: [
          {
            name: "Error Crítico de Diagnóstico",
            success: false,
            message: `Fallo inesperado al ejecutar el motor de diagnóstico de Tauri: ${e}`,
            duration_ms: 0
          }
        ]
      };
    } finally {
      this.diagnosing = false;
      this.cdr.detectChanges();
    }
  }
}
