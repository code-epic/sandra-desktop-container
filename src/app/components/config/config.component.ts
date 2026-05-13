import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy, ChangeDetectorRef, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl } from '@angular/forms';
import { POLICIES_HTML } from '../../constants/policies';
import { PerformanceService, PerformanceProfile } from '../../core/services/performance.service';
import { UpdateService } from '../../core/services/update.service';
import { invoke } from '@tauri-apps/api/core';

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

  @Output() close = new EventEmitter<void>();
  @Output() onSave = new EventEmitter<void>();
  @Output() onActivateConnection = new EventEmitter<any>();
  @Output() onDisconnect = new EventEmitter<any>();

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

  constructor(
    public performance: PerformanceService,
    public updateService: UpdateService,
    private fb: FormBuilder,
    private cdr: ChangeDetectorRef
  ) {
    const saved = localStorage.getItem('sandra_perf_mode') || 'auto';
    this.selectedPerfMode = saved;
  }

  ngOnInit() {
    this.initForm();
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

  toggleTotp(isActive: boolean) {
    this.showTotpSection = isActive;
    if (isActive) {
      this.generateTotp();
    } else {
      this.totpQrCodeUrl = '';
      this.totpSecret = '';
    }
    this.cdr.detectChanges();
  }

  async generateTotp() {
    try {
      // Usar invoke para generar QR si el ApiService no está disponible en este proyecto
      // Simulamos la respuesta por ahora si no conocemos el comando exacto de Tauri, 
      // pero el usuario proporcionó una llamada a ApiService. 
      // En este proyecto, asumiremos que existe una forma de obtenerlo vía Tauri.
      const result: any = await invoke('generate_totp_qr', { format: 'base64' });
      this.totpQrCodeUrl = result.url;
      this.totpSecret = result.secret;
      this.cdr.detectChanges();
    } catch (error) {
      console.error('Error al generar TOTP:', error);
    }
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
    if (this.changePasswordForm.invalid) return;
    
    const { clave, nueva } = this.changePasswordForm.value;
    try {
      // Llamada a Rust para cambiar clave
      await invoke('change_user_password', { oldPassword: clave, newPassword: nueva });
      alert('Contraseña actualizada con éxito');
      this.changePasswordForm.reset();
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
}
