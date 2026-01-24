import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SystemStats } from '../../core/models/telemetry.model';

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

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
