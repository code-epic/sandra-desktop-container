import {
  Component,
  OnInit,
  ElementRef,
  ViewChild,
  Output,
  EventEmitter,
  Input,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { invoke } from "@tauri-apps/api/core";
import { UtilsService } from "../../core/services/utils.service";
import { ISandraJwtPayload } from "../../core/models/security.model";
import { lastValueFrom } from "rxjs";

@Component({
  selector: "app-login-modal",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./login-modal.component.html",
  styleUrls: ["./login-modal.component.css"],
})
export class LoginModalComponent implements OnInit {
  @Input() ipAddress: string = "";
  @Input() port: number = 22;
  @Input() storageTarget: string = "localStorage";
  @Input() variableName: string = "token";

  @Input() connections: any[] = [];
  @Input() requireLogin: boolean = true;

  @Output() onClose = new EventEmitter<void>();
  @Output() onLoginSuccess = new EventEmitter<string>();
  @Output() onConnectionSelect = new EventEmitter<any>();

  showModal: boolean = true;
  showConnectionSelector: boolean = false;
  isHidden: boolean = true;
  showTotpSection: boolean = false;
  verifying: boolean = false;
  verified: boolean = false;
  loading: boolean = false;

  usuario: string = "";
  clave: string = "";
  otpCode: string = "";
  isOtpInvalid: boolean = false;
  errorMessage: string = "";

  // The login token (temp) before TOTP is completed
  tempToken: string = "";

  @ViewChild("otp0") otp0!: ElementRef;

  constructor(private utils: UtilsService) {}

  ngOnInit() {
    // console.log("🛠️ [LoginModal] Componente inicializado. IP:", this.ipAddress, "Port:", this.port);
    this.showModal = true;
    if (this.connections && this.connections.length > 0) {
      this.showConnectionSelector = true;
    }
  }

  selectConnection(conn: any) {
    this.ipAddress = conn.ip_address;
    this.port = Number(conn.port);
    this.onConnectionSelect.emit(conn);

    if (this.requireLogin) {
      this.showConnectionSelector = false;
    } else {
      this.closeModal();
    }
  }

  async login() {
    if (!this.usuario || !this.clave) return;

    this.loading = true;
    this.verifying = true;
    this.verified = false;
    this.errorMessage = "";

    try {
      const endpoint = "v1/api/wusuario/loginPC";

      // Obtener el hash de la última conexión validada (o generarlo si es estático)
      // Como workaround, lo generaremos on-the-fly si no tenemos acceso directo al hash pero sí a la IP
      let currentHash = localStorage.getItem("sdc_ui_config")
        ? JSON.parse(localStorage.getItem("sdc_ui_config")!).connection_hash
        : "";
      if (!currentHash) {
        currentHash = await invoke("get_hash_preview", {
          accountName: this.usuario,
        });
      }

      const payload = {
        Nombre: this.usuario,
        Clave: this.clave,
      };

      const response: any = await invoke("api_post_request", {
        ip: this.ipAddress,
        port: this.port,
        endpoint,
        payload,
        hash: currentHash,
        tempAuthToken: null,
      });

      if (response && response.token !== "") {
        const token = response.token;
        // Decodificar el JWT para verificar si requiere 2FA (TOTP)
        let totpRequired = false;
        try {
          const payload: ISandraJwtPayload = this.utils.decodeJwt(token);
          const usuarioData = payload?.Usuario;
          // Si el JWT contiene un atributo 'token' no vacío en el objeto Usuario, significa que el login requiere 2FA
          // console.log("Decoded Usuario Data:", usuarioData);
          if (
            usuarioData &&
            usuarioData.token &&
            String(usuarioData.token).trim() !== ""
          ) {
            totpRequired = true;
          }
        } catch (e) {
          console.error("Error decodificando JWT:", e);
          totpRequired = false;
        }

        if (totpRequired) {
          // Requires 2FA
          this.tempToken = token;
          this.verifying = false;
          this.loading = false;
          this.showTotpSection = true;
          setTimeout(() => {
            if (this.otp0) this.otp0.nativeElement.focus();
          }, 100);
        } else {
          // Success direct
          this.handleSuccess(token);
        }
      } else {
        throw new Error(response.message || "Login failed");
      }
    } catch (err: any) {
      // console.error("Login error (Tauri API)", err);
      this.verifying = false;
      this.loading = false;
      const msg = this.extractErrorMessage(
        err,
        "Error de autenticación. Verifique credenciales e IP/Puerto.",
      );
      this.showErrorToast(msg);
    }
  }

  extractErrorMessage(err: any, fallbackStr: string): string {
    if (typeof err === "string") {
      try {
        const match = err.match(/\{.*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (parsed && parsed.msj) return parsed.msj;
        }
      } catch (e) {}
    }
    return fallbackStr;
  }

  showErrorToast(msg: string) {
    this.errorMessage = msg;
    setTimeout(() => {
      this.errorMessage = "";
    }, 4000);
  }

  async Continuar() {
    this.otpCode = this.getOtpValue();
    if (this.otpCode.length < 6) {
      this.isOtpInvalid = true;
      setTimeout(() => (this.isOtpInvalid = false), 800);
      return;
    }

    this.loading = true;

    try {
      const endpoint = "v1/api/wusuario/vtotpPC";

      let currentHash = localStorage.getItem("sdc_ui_config")
        ? JSON.parse(localStorage.getItem("sdc_ui_config")!).connection_hash ||
          ""
        : "";
      if (!currentHash) {
        currentHash = await invoke("get_hash_preview", {
          accountName: this.usuario,
        });
      }

      const payload = {
        Codigo: this.otpCode,
      };

      const response: any = await invoke("api_post_request", {
        ip: this.ipAddress,
        port: this.port,
        endpoint,
        payload,
        hash: currentHash,
        tempAuthToken: this.tempToken,
      });

      if (response && response.msj === "Ok") {
        this.showTotpSection = false;
        this.verifying = true;
        this.handleSuccess(this.tempToken);
      } else {
        throw new Error("TOTP Invalid");
      }
    } catch (err: any) {
      this.isOtpInvalid = true;
      this.loading = false;
      const msg = this.extractErrorMessage(
        err,
        "El código dinámico ingresado es incorrecto o expiró.",
      );
      this.showErrorToast(msg);
      setTimeout(() => (this.isOtpInvalid = false), 800);
    }
  }

  async handleSuccess(token: string) {
    this.verified = true;
    this.loading = false;

    // Store requested variable
    if (this.storageTarget === "localStorage") {
      localStorage.setItem(this.variableName, token);
    } else {
      sessionStorage.setItem(this.variableName, token);
    }

    // Extraction of login from JWT and MAC Address update
    try {
      // 1. Extraer el payload del JWT usando el patrón centralizado
      const payload: ISandraJwtPayload = this.utils.decodeJwt(token);
      const usuarioData = payload?.Usuario;
      const login = usuarioData?.usuario || payload?.sid || this.usuario;

      // 2. Actualizar active_connection en localStorage con el nuevo perfil y JWT
      const storedConn = localStorage.getItem("active_connection");
      if (storedConn) {
        try {
          const conn = JSON.parse(storedConn);
          // Actualizar estrictamente solo el campo username con el login obtenido
          conn.username = login;
          localStorage.setItem("active_connection", JSON.stringify(conn));
          // console.log("✅ [Login] active_connection actualizada con username:", login);
        } catch (e) {
          console.warn(
            "[Login] Error actualizando active_connection persistida",
            e,
          );
        }
      }

      // 3. Obtener la MAC Address del sistema
      const stats: any = await invoke("get_system_telemetry");
      const macAddress = stats.mac_address || "00:00:00:00:00:00";

      // 3. Obtener el hash para el endpoint
      let currentHash = localStorage.getItem("sdc_ui_config")
        ? JSON.parse(localStorage.getItem("sdc_ui_config")!).connection_hash
        : "";
      if (!currentHash) {
        currentHash = await invoke("get_hash_preview", {
          accountName: this.usuario,
        });
      }

      // 4. Actualizar MAC Address mediante el endpoint v1/api/crud:{hash}
      const crudEndpoint = `v1/api/crud:${currentHash}`;
      const crudPayload = {
        funcion: "SDC_UUserMacAddress",
        parametros: `${login},${macAddress}`,
      };

      await invoke("api_post_request", {
        ip: this.ipAddress,
        port: this.port,
        endpoint: crudEndpoint,
        payload: crudPayload,
        hash: currentHash,
        tempAuthToken: token,
      });
      // console.log("MAC Address updated successfully");
    } catch (err) {
      console.error(
        "Error updating MAC address during login success phase:",
        err,
      );
    }

    // Sync to SQLite (Connections table)
    invoke("update_connection_auth", {
      ip: this.ipAddress,
      port: this.port,
      token: token,
    }).catch((err) => console.error("Error syncing auth to DB:", err));

    setTimeout(() => {
      this.showModal = false;
      this.onLoginSuccess.emit(token);
      this.onClose.emit();
    }, 1500);
  }

  closeModal() {
    this.showModal = false;
    this.onClose.emit();
  }

  goBackToLogin() {
    this.showTotpSection = false;
    this.tempToken = "";
    this.otpCode = "";
  }

  /* OTP Input Logic */
  onInput(event: Event, nextInput: HTMLInputElement | null) {
    const input = event.target as HTMLInputElement;
    if (input.value && nextInput) {
      nextInput.focus();
    }
  }

  onKeydown(event: KeyboardEvent, prevInput: HTMLInputElement | null) {
    const input = event.target as HTMLInputElement;
    if (event.key === "Backspace" && !input.value && prevInput) {
      prevInput.focus();
    }
  }

  onPaste(event: ClipboardEvent) {
    event.preventDefault();
    const pastedData = event.clipboardData?.getData("text/plain");
    if (pastedData) {
      const digits = pastedData.replace(/\D/g, "").substring(0, 6);
      if (digits.length > 0) {
        const inputs = Array.from(
          document.querySelectorAll(".otp-box"),
        ) as HTMLInputElement[];
        digits.split("").forEach((d, i) => {
          if (inputs[i]) inputs[i].value = d;
        });
        if (inputs[digits.length - 1]) {
          inputs[digits.length - 1].focus();
        } else if (inputs[5]) {
          inputs[5].focus();
        }
      }
    }
  }

  getOtpValue(): string {
    const inputs = document.querySelectorAll(
      ".otp-box",
    ) as NodeListOf<HTMLInputElement>;
    let val = "";
    inputs.forEach((input) => (val += input.value));
    return val;
  }
}
