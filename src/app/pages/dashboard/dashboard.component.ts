import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SystemStats } from '../../core/models/telemetry.model';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['../../app.component.css']
})
export class DashboardComponent {
  @Input() stats: SystemStats | null = null;
  @Input() networkInfo: string[] = [];
  @Input() apps: any[] = [];
  
  // Eventos hacia el padre (AppComponent)
  @Output() onInstall = new EventEmitter<any>();
  @Output() onOpen = new EventEmitter<any>();
  @Output() onUpdate = new EventEmitter<any>();
  @Output() onDelete = new EventEmitter<any>();
  @Output() onDbClick = new EventEmitter<void>();

  formatBytes(bytes: number): string {
    return (bytes / (1024 ** 3)).toFixed(2) + ' GB';
  }
}
