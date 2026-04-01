import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SystemStats } from '../../core/models/telemetry.model';
import { UtilsService } from '../../core/services/utils.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['../../app.component.css', './dashboard.component.css']
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

  constructor(public utils: UtilsService) {}

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
    this.checkPublicIp();
  }

  closeModal() {
    this.showInfoModal = false;
  }

  async checkPublicIp() {
    try {
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      this.publicIp = data.ip;
    } catch (e) {
      this.publicIp = 'No disponible';
    }
  }
}
