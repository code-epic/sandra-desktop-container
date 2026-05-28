import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { invoke } from '@tauri-apps/api/core';
import { SystemStats } from '../../core/models/telemetry.model';
import { UtilsService } from '../../core/services/utils.service';
import { ModalComponent } from '../../components/modal/modal.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: ['../../app.component.css', './dashboard.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardComponent {
  @Input() stats: SystemStats | null = null;
  @Input() networkInfo: string[] = [];
  @Input() apps: any[] = [];
  @Input() dbStats: any = null;

  // Eventos hacia el padre (AppComponent)
  @Output() onInstall = new EventEmitter<any>();
  @Output() onOpen = new EventEmitter<any>();
  @Output() onUpdate = new EventEmitter<any>();
  @Output() onDelete = new EventEmitter<any>();
  @Output() onDbClick = new EventEmitter<void>();
  @Output() onMacClick = new EventEmitter<void>();
  @Output() onIpClick = new EventEmitter<void>();
  @Output() onIdentityUpdate = new EventEmitter<void>();

  machineName: string = '';
  machineArea: string = '';
  machineDescription: string = '';
  isSavingIdentity: boolean = false;
  confirmingSave: boolean = false;
  activeModalTab: 'network' | 'identity' = 'network';

  constructor(public utils: UtilsService, private cdr: ChangeDetectorRef) {}

  formatBytes(bytes: number): string {
    return this.utils.formatBytes(bytes);
  }

  getOsIcon(osInfo: string): string {
    if (!osInfo) return 'fas fa-desktop';
    const lower = osInfo.toLowerCase();
    if (lower.includes('mac') || lower.includes('darwin')) return 'fab fa-apple';
    if (lower.includes('win')) return 'fab fa-windows';
    if (lower.includes('linux') || lower.includes('ubuntu') || lower.includes('debian')) return 'fab fa-linux';
    return 'fas fa-desktop';
  }
  showInfoModal = false;
  publicIp = 'Cargando...';

  openInfoModal() {
    this.showInfoModal = true;
    this.activeModalTab = 'network';
    this.confirmingSave = false;
    this.checkPublicIp();
    this.loadIdentity();
  }

  async loadIdentity() {
    try {
      const status: any = await invoke("get_setup_status");
      this.machineName = status.machine_name || '';
      this.machineArea = status.machine_area || '';
      this.machineDescription = status.machine_description || '';
      this.cdr.markForCheck();
    } catch (e) {
      console.error("Error al cargar identidad", e);
    }
  }

  async saveIdentity() {
    if (!this.machineName.trim()) return;
    this.isSavingIdentity = true;
    this.cdr.markForCheck();
    try {
      await invoke("save_setup_data", {
        name: this.machineName.trim(),
        description: this.machineDescription.trim(),
        area: this.machineArea.trim()
      });
      this.onIdentityUpdate.emit();
      this.closeModal();
    } catch (e) {
      console.error("Error al guardar identidad", e);
    } finally {
      this.isSavingIdentity = false;
      this.cdr.markForCheck();
    }
  }

  closeModal() {
    this.showInfoModal = false;
    this.confirmingSave = false;
  }

  async checkPublicIp() {
    try {
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      this.publicIp = data.ip;
    } catch (e) {
      this.publicIp = 'No disponible';
    } finally {
      this.cdr.markForCheck();
    }
  }
}
