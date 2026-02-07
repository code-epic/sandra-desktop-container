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
  source?: string;
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
  showCloseConfirmModal = false;

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

    // 1. Hydrate existing logs
    this.logger.getUnsavedLogs().forEach(log => this.processLog(log));

    // 2. Subscribe to Logger for live updates
    this.logger.logs$.subscribe(log => this.processLog(log));

    this.activeTabId$.subscribe(id => {
      this.currentTabId = id;
      this.loadLogsForActiveTab();
    });
  }

  private processLog(log: any) {
    const targetAppId = log.app_id || 'App.SDC';

    // Duplicate Check (Basic) - prevent re-adding identical logs during hydration overlap
    const existingLogs = this.sessionLogs.get(targetAppId);
    const tsString = log.timestamp instanceof Date ? log.timestamp.toISOString() : log.timestamp;

    if (existingLogs && existingLogs.some(l => l.timestamp === tsString && l.message === log.message)) {
      return;
    }

    const appLog: AppLog = {
      app_id: targetAppId,
      log_type: log.type === 'INFO' ? 'LOG' : log.type,
      message: log.message,
      source: log.source,
      timestamp: tsString,
      details: log.details
    };

    if (!this.sessionLogs.has(targetAppId)) {
      this.sessionLogs.set(targetAppId, []);
    }
    this.sessionLogs.get(targetAppId)?.unshift(appLog);

    // UI Update if active
    if (this.shouldShowLogForCurrentTab(targetAppId)) {
      this.loadLogsForActiveTab();
    }
  }

  private shouldShowLogForCurrentTab(logAppId: string): boolean {
    if (this.currentTabId === logAppId) return true;
    const systemTabs = ['dashboard', 'connections', 'security', 'monitor', 'system', 'apps', 'secure-viewer'];
    if (systemTabs.includes(this.currentTabId) && logAppId === 'App.SDC') return true;
    return false;
  }

  async loadLogsForActiveTab() {
    let targetAppId = this.currentTabId;
    const systemTabs = ['dashboard', 'connections', 'security', 'monitor', 'system', 'apps', 'secure-viewer'];
    if (systemTabs.includes(targetAppId)) {
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
      // Pass separate app_id and source
      return this.logger.persistBackend(log.log_type, log.message, log.details, log.app_id, log.timestamp, log.source);
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
    // 1. Evaluate if current view has XHR/Fetch logs THAT ARE NOT SAVED
    const hasUnsavedNetworkLogs = this.currentAppLogs.some(l =>
      !l.id && (l.log_type === 'FETCH' || l.log_type === 'XHR' || (l.message && l.message.includes('XHR')))
    );

    // 2. Ask to save if detected
    if (hasUnsavedNetworkLogs) {
      this.showCloseConfirmModal = true;
    } else {
      this.appState.toggleRightSidebar();
    }
  }

  async proceedCloseInspector(shouldSave: boolean) {
    this.showCloseConfirmModal = false;
    if (shouldSave) {
      await this.confirmSaveLogs();
    }
    this.appState.toggleRightSidebar();
  }
}
