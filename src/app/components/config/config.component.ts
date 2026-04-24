import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { POLICIES_HTML } from '../../constants/policies';
import { PerformanceService, PerformanceProfile } from '../../core/services/performance.service';
import { UpdateService } from '../../core/services/update.service';

@Component({
  selector: 'app-config',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './config.component.html',
  styleUrls: ['./config.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConfigComponent {
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

  constructor(
    public performance: PerformanceService,
    public updateService: UpdateService
  ) {
    const saved = localStorage.getItem('sandra_perf_mode') || 'auto';
    this.selectedPerfMode = saved;
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
