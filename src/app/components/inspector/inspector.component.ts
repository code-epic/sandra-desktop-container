import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { AppStateService } from '../../core/services/app-state.service';
import { LoggerService } from '../../core/services/logger.service';
import { invoke } from "@tauri-apps/api/core";

interface AppLog {
  id?: number;
  app_id: string;
  log_type: string;
  message: string;
  timestamp?: string;
  details?: any;
}

@Component({
  selector: 'app-inspector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './inspector.component.html',
  styleUrls: ['./inspector.component.css']
})
export class InspectorComponent implements OnInit {
  rightSidebarOpen$: Observable<boolean>;
  activeTabId$: Observable<string>;

  currentTabId: string = 'dashboard';
  currentAppLogs: AppLog[] = [];
  selectedLog: AppLog | null = null;

  inspectorTreeOpen = true;
  inspectorConsoleOpen = true;
  inspectorNetworkOpen = true;
  inspectorDetailModal = false;
  showSaveConfirmModal = false;

  get inspectorConsoleLogs() {
    return this.currentAppLogs.filter(l => ['LOG', 'INFO', 'WARN', 'ERROR', 'SUCCESS'].includes(l.log_type));
  }

  get inspectorNetworkLogs() {
    return this.currentAppLogs.filter(l => l.log_type === 'FETCH');
  }

  get unsavedLogsCount(): number {
    return this.currentAppLogs.filter(l => !l.id).length;
  }

  // Store logs in memory per App ID (session only)
  private sessionLogs: Map<string, AppLog[]> = new Map();

  constructor(
    public appState: AppStateService,
    private logger: LoggerService
  ) {
    this.rightSidebarOpen$ = this.appState.rightSidebarOpen$;
    this.activeTabId$ = this.appState.activeTabId$;

    // Subscribe to Logger for live updates
    this.logger.logs$.subscribe(log => {
      // Determine source App ID
      let source = this.currentTabId !== 'dashboard' ? (log.source || this.currentTabId) : 'App.SDC';
      if (source === 'external-app' || source === 'unknown-app') source = this.currentTabId;

      const appLog: AppLog = {
        app_id: source,
        log_type: log.type === 'INFO' ? 'LOG' : log.type,
        message: log.message,
        timestamp: log.timestamp.toISOString(),
        details: log.details
      };

      // Add to session memory
      if (!this.sessionLogs.has(source)) {
        this.sessionLogs.set(source, []);
      }
      this.sessionLogs.get(source)?.unshift(appLog);

      // If viewing this app, update UI immediately
      if (this.currentTabId === source || (['dashboard', 'connections', 'security', 'monitor', 'system'].includes(this.currentTabId) && source === 'App.SDC')) {
        this.loadLogsForActiveTab();
      }
    });

    this.activeTabId$.subscribe(id => {
      this.currentTabId = id;
      this.loadLogsForActiveTab();
    });
  }

  async loadLogsForActiveTab() {
    let targetAppId = this.currentTabId;
    if (['dashboard', 'connections', 'security', 'monitor', 'system'].includes(targetAppId)) {
      targetAppId = 'App.SDC';
    }

    // Load purely from memory (Session Cache), no DB query
    this.currentAppLogs = this.sessionLogs.get(targetAppId) || [];
  }

  ngOnInit() {
    this.activeTabId$.subscribe(id => {
      this.currentTabId = id;
      this.loadLogsForActiveTab();
    });
  }

  toggleInspectorTree() {
    this.inspectorTreeOpen = !this.inspectorTreeOpen;
    if (this.inspectorTreeOpen) {
      this.loadLogsForActiveTab();
    }
  }

  toggleConsole() { this.inspectorConsoleOpen = !this.inspectorConsoleOpen; }
  toggleNetwork() { this.inspectorNetworkOpen = !this.inspectorNetworkOpen; }

  viewLogDetails(log: AppLog) {
    this.selectedLog = log;
    this.inspectorDetailModal = true;
  }

  closeInspectorModal() {
    this.inspectorDetailModal = false;
    this.selectedLog = null;
  }


  // Toggles...

  clearInspectorLogs() {
    // 1. Clear current view immediately
    this.currentAppLogs = [];

    // 2. determine targetAppId
    let targetAppId = this.currentTabId;
    if (['dashboard', 'connections', 'security', 'monitor', 'system'].includes(targetAppId)) {
      targetAppId = 'App.SDC';
    }

    // 3. Clear from memory
    this.sessionLogs.set(targetAppId, []);
  }

  saveInspectorLogs() {
    if (this.unsavedLogsCount > 0) {
      this.showSaveConfirmModal = true;
    }
  }

  async confirmSaveLogs() {
    this.showSaveConfirmModal = false;
    const logsToSave = this.currentAppLogs.filter(log => !log.id);

    const promises = logsToSave.map(log => {
      // Persist to backend without reloading immediately if we want to clear them
      return this.logger.persistBackend(log.log_type, log.message, log.details, log.app_id, log.timestamp);
    });

    await Promise.all(promises);

    // REQUIREMENT: "cuando se pulse el boton guardar limpie los logs del app activa"
    // Clear logs from memory/view
    this.clearInspectorLogs();
  }

  cancelSaveLogs() {
    this.showSaveConfirmModal = false;
  }

  closeInspector() {
    this.appState.toggleRightSidebar();
  }
}
