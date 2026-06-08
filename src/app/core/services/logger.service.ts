import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AppStateService } from "./app-state.service";
import { SecurityService } from "./security.service";

export interface LogEntry {
  id?: number; // Added for tracking persistence
  type: 'INFO' | 'ERROR' | 'WARN' | 'SUCCESS' | 'FETCH' | 'XHR';
  message: string;
  timestamp: Date;
  app_id: string; // The Application ID (e.g. 'gdoc')
  source: string; // The Origin/Module (e.g. 'Bridge', 'Fetch', 'System')
  details?: any;
  user_login?: string;
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

  constructor(
    private appState: AppStateService,
    private securityService: SecurityService
  ) {
    this.appState.activeTabId$.subscribe(id => {
      // Expanded system tabs list to include 'apps' and 'secure-viewer'
      if (['dashboard', 'connections', 'security', 'monitor', 'system', 'apps', 'secure-viewer'].includes(id)) {
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

  async clearLogs(appId?: string) {
    if (appId) {
      this.unsavedLogs = this.unsavedLogs.filter(l => l.app_id !== appId);
      try {
        await invoke('clear_app_logs', { appId });
      } catch (err) {
        console.error('Failed to clear app logs in backend:', err);
      }
    } else {
      this.unsavedLogs = [];
      try {
        await invoke('clear_app_logs', { appId: null });
      } catch (err) {
        console.error('Failed to clear all app logs in backend:', err);
      }
    }
  }

  hasLogs(appId?: string): boolean {
    if (appId) {
      return this.unsavedLogs.some(l => l.app_id === appId);
    }
    return this.unsavedLogs.length > 0;
  }

  hasXhrLogsForApp(appId?: string): boolean {
    const isNetwork = (l: LogEntry) => l.type === 'XHR' || l.type === 'FETCH' || l.message.includes('XHR');
    if (appId) {
      return this.unsavedLogs.some(l => l.app_id === appId && isNetwork(l));
    }
    return this.unsavedLogs.some(isNetwork);
  }

  async saveAllLogs(appId?: string) {
    const logsToSave = appId ? this.unsavedLogs.filter(l => l.app_id === appId) : this.unsavedLogs;

    for (const log of logsToSave) {
      await this.persistBackend(log.type, log.message, log.details, log.app_id, log.timestamp.toISOString(), log.source);
    }

    await this.clearLogs(appId);
  }

  initialize() {
    if (this.initialized) return;
    this.initialized = true;

    // Escuchar eventos nativos de Rust (Inspector Proxy)
    listen('app:log_network', (event: any) => {
      const payload = event.payload;
      const entry: LogEntry = {
        type: payload.log_type as any,
        message: payload.message,
        timestamp: new Date(),
        app_id: payload.app_id || this.currentAppId,
        source: payload.details?.source || 'Rust Proxy',
        details: payload.details
      };
      this.unsavedLogs.push(entry);
      this.logSubject.next(entry);
    });

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

    // Intercept XHR
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const self = this;

    XMLHttpRequest.prototype.open = function (method: string, url: string | URL) {
      (this as any)._method = method;
      (this as any)._url = url ? url.toString() : '';
      return originalOpen.apply(this, arguments as any);
    };

    XMLHttpRequest.prototype.send = function (body: any) {
      const xhr = this as any;

      // Filter noisy internal requests based on URL
      if (xhr._url && (xhr._url.includes('save_app_log') || xhr._url.includes('ipc://') || xhr._url.includes('get_system_telemetry'))) {
        return originalSend.apply(this, arguments as any);
      }

      this.addEventListener('load', function () {
        const type = this.status >= 400 ? 'ERROR' : 'XHR';
        const msg = `${xhr._method || 'GET'} ${xhr._url} [${this.status}]`;
        // Log details if available (status text, etc)
        self.persistLog(type, msg, 'Network', self.currentAppId);
      });

      this.addEventListener('error', function () {
        self.persistLog('ERROR', `XHR Error: ${xhr._method || 'GET'} ${xhr._url}`, 'Network', self.currentAppId);
      });

      return originalSend.apply(this, arguments as any);
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

  public async persistBackend(type: string, message: string, details: any, appId: string, timestamp?: string, source?: string): Promise<number | null> {
    let backendType = type;
    if (type === 'INFO') backendType = 'LOG';

    try {
      // Rust returns () so we await implicitly.
      await invoke('save_app_log', {
        log: {
          app_id: appId,
          log_type: backendType,
          message: message,
          details: details,
          source: source || 'System',
          timestamp: timestamp,
          user_login: this.securityService.getCurrentUserLogin()
        }
      });
      // Return a dummy ID to indicate success to the frontend
      return 1;
    } catch (err) {
      this.originalConsoleLog('[LoggerService] Failed to persist log:', err);
      return null;
    }
  }

  log(type: 'INFO' | 'ERROR' | 'WARN' | 'SUCCESS' | 'FETCH' | 'XHR', message: string, source: string = 'System', appId?: string) {
    this.persistLog(type, message, source, appId || this.currentAppId);
  }

  async getAppLogs(appId: string): Promise<LogEntry[]> {
    return await invoke('get_app_logs', { 
      appId, 
      userLogin: this.securityService.getCurrentUserLogin() 
    });
  }
}