import { Component, OnInit, HostListener } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
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
  dockPosition: 'right' | 'bottom' = 'right';
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
    private logger: LoggerService,
    private sanitizer: DomSanitizer
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
    const resolvedTabId = this.appState.resolveAppId(this.currentTabId);
    if (resolvedTabId === logAppId) return true;
    const systemTabs = ['dashboard', 'connections', 'security', 'monitor', 'system', 'apps', 'secure-viewer'];
    if (systemTabs.includes(this.currentTabId) && logAppId === 'App.SDC') return true;
    return false;
  }

  async loadLogsForActiveTab() {
    let targetAppId = this.appState.resolveAppId(this.currentTabId) || this.currentTabId;
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
    this.jsonCache.clear();
    this.inspectorDetailModal = true;
  }

  deleteLog(log: AppLog, event: Event) {
    event.stopPropagation();
    const appLogs = this.sessionLogs.get(log.app_id);
    if (appLogs) {
      const index = appLogs.indexOf(log);
      if (index > -1) {
        appLogs.splice(index, 1);
        this.loadLogsForActiveTab();
      }
    }
  }

  private jsonCache = new Map<any, SafeHtml>();

  getLogSource(val: any): string | null {
    if (typeof val !== 'string') return null;
    const fuenteMatch = val.match(/\s*\[Fuente:\s*(.*?)\]\s*$/);
    return fuenteMatch ? fuenteMatch[1] : null;
  }

  formatJsonHtml(val: any): SafeHtml {
    if (!val) return '';
    if (this.jsonCache.has(val)) {
      return this.jsonCache.get(val)!;
    }

    let obj = val;
    
    if (typeof val === 'string') {
      let cleanVal = val.replace(/\s*\[Fuente:\s*(.*?)\]\s*$/, '');

      try {
        obj = JSON.parse(cleanVal);
        const safeHtml = this.sanitizer.bypassSecurityTrustHtml(this.buildCollapsibleJson(obj));
        this.jsonCache.set(val, safeHtml);
        return safeHtml;
      } catch (e) {
        let resultHtml = '';
        let currentText = '';
        let i = 0;
        
        while (i < cleanVal.length) {
          if (cleanVal[i] === '{' || cleanVal[i] === '[') {
            let open = cleanVal[i];
            let close = open === '{' ? '}' : ']';
            let depth = 0;
            let j = i;
            let inString = false;
            let escape = false;
            
            while (j < cleanVal.length) {
              let char = cleanVal[j];
              if (!escape && char === '"') inString = !inString;
              if (char === '\\' && !escape) escape = true;
              else escape = false;
              
              if (!inString) {
                if (char === open) depth++;
                else if (char === close) depth--;
              }
              
              j++;
              if (depth === 0) break;
            }
            
            if (depth === 0) {
              const possibleJson = cleanVal.substring(i, j);
              try {
                const parsed = JSON.parse(possibleJson);
                if (currentText.trim()) {
                  resultHtml += `<div class="mixed-text">${this.escapeAndHighlight(currentText)}</div>`;
                }
                currentText = '';
                resultHtml += `<div class="mixed-json">${this.buildCollapsibleJson(parsed)}</div>`;
                i = j;
                continue;
              } catch (err) {
                // Not valid JSON
              }
            }
          }
          currentText += cleanVal[i];
          i++;
        }
        
        if (currentText.trim()) {
           resultHtml += `<div class="mixed-text">${this.escapeAndHighlight(currentText)}</div>`;
        }

        const safeHtml = this.sanitizer.bypassSecurityTrustHtml(resultHtml);
        this.jsonCache.set(val, safeHtml);
        return safeHtml;
      }
    }
    
    const safeHtml = this.sanitizer.bypassSecurityTrustHtml(this.buildCollapsibleJson(obj));
    this.jsonCache.set(val, safeHtml);
    return safeHtml;
  }

  private escapeAndHighlight(cleanVal: string): string {
    let escaped = String(cleanVal).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    escaped = escaped.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
        let cls = 'json-number';
        if (/^"/.test(match)) {
            if (/:$/.test(match)) { cls = 'json-key'; } else { cls = 'json-string'; }
        } else if (/true|false/.test(match)) { cls = 'json-boolean'; }
        return '<span class="' + cls + '">' + match + '</span>';
    });
    return escaped;
  }

  private buildCollapsibleJson(obj: any): string {
    if (obj === null) return `<span class="json-null">null</span>`;
    if (typeof obj === 'boolean') return `<span class="json-boolean">${obj}</span>`;
    if (typeof obj === 'number') return `<span class="json-number">${obj}</span>`;
    if (typeof obj === 'string') {
        const escaped = obj.replace(/[&<>"']/g, function(m) {
            const map: any = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
            return map[m];
        });
        return `<span class="json-string">"${escaped}"</span>`;
    }

    if (Array.isArray(obj)) {
      if (obj.length === 0) return `<span class="json-bracket">[]</span>`;
      let html = `<details open class="json-details"><summary class="json-summary"><span class="json-bracket">[</span><span class="json-preview"> ${obj.length} items </span></summary><div class="json-children">`;
      obj.forEach((val, i) => {
        html += `<div class="json-line">${this.buildCollapsibleJson(val)}${i < obj.length - 1 ? '<span class="json-bracket">,</span>' : ''}</div>`;
      });
      html += `</div></details><span class="json-bracket">]</span>`;
      return html;
    }

    if (typeof obj === 'object') {
      const keys = Object.keys(obj);
      if (keys.length === 0) return `<span class="json-brace">{}</span>`;
      let html = `<details open class="json-details"><summary class="json-summary"><span class="json-brace">{</span><span class="json-preview"> ${keys.length} keys </span></summary><div class="json-children">`;
      keys.forEach((key, i) => {
        html += `<div class="json-line"><span class="json-key">"${key}"</span><span class="json-bracket">: </span>${this.buildCollapsibleJson(obj[key])}${i < keys.length - 1 ? '<span class="json-bracket">,</span>' : ''}</div>`;
      });
      html += `</div></details><span class="json-brace">}</span>`;
      return html;
    }
    return '';
  }

  getJsonElementCount(val: any): number | null {
    if (!val) return null;
    let obj = val;
    if (typeof val === 'string') {
      const cleanVal = val.replace(/\s*\[Fuente:\s*(.*?)\]\s*$/, '');
      try {
        obj = JSON.parse(cleanVal);
      } catch {
        return null; // Not valid JSON
      }
    }
    if (Array.isArray(obj)) return obj.length;
    if (typeof obj === 'object') return Object.keys(obj).length;
    return null;
  }

  copyState: { [key: string]: boolean } = {};

  async copyToClipboard(val: any, type: string) {
    let text = val;
    if (typeof val !== 'string') {
      text = JSON.stringify(val, null, 2);
    } else {
      try {
        text = JSON.stringify(JSON.parse(val), null, 2);
      } catch (e) {
        // keep as is
      }
    }
    if (navigator && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        this.copyState[type] = true;
        setTimeout(() => {
          this.copyState[type] = false;
        }, 1500);
    }
  }

  @HostListener('window:request-inspector-close')
  handleRequestClose() {
    this.closeInspector();
  }

  toggleDock() {
    this.dockPosition = this.dockPosition === 'right' ? 'bottom' : 'right';
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
    let targetAppId = this.appState.resolveAppId(this.currentTabId) || this.currentTabId;
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
