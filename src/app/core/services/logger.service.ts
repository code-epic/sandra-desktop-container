import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { invoke } from "@tauri-apps/api/core";
import { AppStateService } from "./app-state.service";

export interface LogEntry {
  type: 'INFO' | 'ERROR' | 'WARN' | 'SUCCESS' | 'FETCH' | 'XHR';
  message: string;
  timestamp: Date;
  app_id: string; // The Application ID (e.g. 'gdoc')
  source: string; // The Origin/Module (e.g. 'Bridge', 'Fetch', 'System')
  details?: any;
}

@Injectable({
  providedIn: 'root'
})
export class LoggerService {
  private logSubject = new Subject<LogEntry>();
  logs$ = this.logSubject.asObservable();
  private originalConsoleLog = console.log;
  private originalConsoleError = console.error;
  private originalConsoleWarn = console.warn;
  private initialized = false;

  private currentAppId: string = 'App.SDC';
  private unsavedLogs: LogEntry[] = [];

  constructor(private appState: AppStateService) {
    this.appState.activeTabId$.subscribe(id => {
      if (['dashboard', 'connections', 'security', 'monitor', 'system'].includes(id)) {
        this.currentAppId = 'App.SDC';
      } else {
        this.currentAppId = id;
      }
    });
  }

  getAlledLogs(): LogEntry[] {
    return this.unsavedLogs;
  }

  getUnsavedLogs(appId?: string) {
    if (appId) {
      return this.unsavedLogs.filter(l => l.app_id === appId);
    }
    return this.unsavedLogs;
  }

  clearLogs(appId?: string) {
    if (appId) {
      this.unsavedLogs = this.unsavedLogs.filter(l => l.app_id !== appId);
    } else {
      this.unsavedLogs = [];
    }
  }

  hasLogs(appId?: string): boolean {
    if (appId) {
      return this.unsavedLogs.some(l => l.app_id === appId);
    }
    return this.unsavedLogs.length > 0;
  }

  hasXhrLogsForApp(appId?: string): boolean {
    if (appId) {
      return this.unsavedLogs.some(l => l.app_id === appId && (l.type === 'XHR' || l.type === 'FETCH' || l.message.includes('XHR')));
    }
    return this.unsavedLogs.some(l => l.type === 'XHR' || l.type === 'FETCH' || l.message.includes('XHR'));
  }

  async saveAllLogs(appId?: string) {
    const logsToSave = appId ? this.unsavedLogs.filter(l => l.app_id === appId) : this.unsavedLogs;

    for (const log of logsToSave) {
      await this.persistBackend(log.type, log.message, log.details, log.app_id, log.timestamp.toISOString(), log.source);
    }

    this.clearLogs(appId);
  }

  initialize() {
    if (this.initialized) return;
    this.initialized = true;

    // Listen for logs from Iframe Apps (Bridge)
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'SDC_LOG') {
        const payload = event.data.payload;

        let appId = payload.app_id;
        if (!appId || appId === 'unknown-app') {
          appId = this.currentAppId;
        }

        const logType = payload.log_type || 'INFO';
        const message = payload.message || '';
        const details = payload.details || null;

        const entry: LogEntry = {
          type: logType as any,
          message: message,
          timestamp: new Date(),
          app_id: appId,
          source: 'Bridge',
          details: details
        };

        this.unsavedLogs.push(entry);
        this.logSubject.next(entry);
      }
    });

    console.error = (...args) => {
      this.originalConsoleError.apply(console, args);
      this.persistLog('ERROR', args.join(' '), 'Console', this.currentAppId);
    };

    // Intercept Fetch
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const [resource, config] = args;
      const url = resource.toString();

      if (url.includes('save_app_log') ||
        url.includes('ipc://') ||
        url.includes('get_system_telemetry')) {
        return originalFetch(...args);
      }

      try {
        const response = await originalFetch(...args);

        const type = response.status >= 400 ? 'ERROR' : 'FETCH';
        const msg = `${config?.method || 'GET'} ${url} [${response.status}]`;

        this.persistLog(type, msg, 'Network', this.currentAppId);

        return response;
      } catch (err: any) {
        this.persistLog('ERROR', `Fetch Exception: ${url} - ${err.message}`, 'Network', this.currentAppId);
        throw err;
      }
    };

    this.originalConsoleLog('[LoggerService] Initialized and capturing console/network events.');
  }

  private persistLog(type: 'INFO' | 'ERROR' | 'WARN' | 'SUCCESS' | 'FETCH' | 'XHR', message: string, source: string = 'System', appId?: string) {
    if (message.includes('[LoggerService]') || message.includes('save_app_log')) return;

    const effectiveAppId = appId || this.currentAppId;

    const entry: LogEntry = {
      type,
      message,
      timestamp: new Date(),
      app_id: effectiveAppId,
      source: source
    };

    this.unsavedLogs.push(entry);
    this.logSubject.next(entry);
  }

  public async persistBackend(type: string, message: string, details: any, appId: string, timestamp?: string, source?: string) {
    let backendType = type;
    if (type === 'INFO') backendType = 'LOG';

    try {
      await invoke('save_app_log', {
        log: {
          app_id: appId,
          log_type: backendType,
          message: message,
          details: details,
          source: source || 'System',
          timestamp: timestamp
        }
      });
    } catch (err) {
      this.originalConsoleLog('[LoggerService] Failed to persist log:', err);
    }
  }

  log(type: 'INFO' | 'ERROR' | 'WARN' | 'SUCCESS' | 'FETCH' | 'XHR', message: string, source: string = 'System', appId?: string) {
    this.persistLog(type, message, source, appId || this.currentAppId);
  }
}