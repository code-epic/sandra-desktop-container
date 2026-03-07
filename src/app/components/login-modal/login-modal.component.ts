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

  @Output() onClose = new EventEmitter<void>();
  @Output() onLoginSuccess = new EventEmitter<string>();

  showModal: boolean = true;
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

  constructor() {}

  ngOnInit() {}

  async login() {
    if (!this.usuario || !this.clave) return;

    this.loading = true;
    this.verifying = true;
    this.verified = false;
    this.errorMessage = "";

    try {
      const endpoint = "v1/api/wusuario/loginV2";

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
          const payloadPart = token.split(".")[1];
          const decodedPayload = JSON.parse(atob(payloadPart));
          // Si el JWT contiene un atributo 'token' no vacío, significa que el login requiere 2FA
          if (
            decodedPayload &&
            decodedPayload.token &&
            String(decodedPayload.token).trim() !== ""
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
      console.error("Login error (Tauri API)", err);
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
      const endpoint = "v1/api/wusuario/verify_totp";

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
        token: this.tempToken,
        totp_code: this.otpCode,
      };

      const response: any = await invoke("api_post_request", {
        ip: this.ipAddress,
        port: this.port,
        endpoint,
        payload,
        hash: currentHash,
        tempAuthToken: this.tempToken,
      });

      if (response && response.status === "success") {
        this.showTotpSection = false;
        this.verifying = true;
        this.handleSuccess(response.token || this.tempToken);
      } else {
        throw new Error("TOTP Invalid");
      }
    } catch (err: any) {
      console.error("TOTP error (Tauri API)", err);
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

  handleSuccess(token: string) {
    this.verified = true;
    this.loading = false;

    // Store requested variable
    if (this.storageTarget === "localStorage") {
      localStorage.setItem(this.variableName, token);
    } else {
      sessionStorage.setItem(this.variableName, token);
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
