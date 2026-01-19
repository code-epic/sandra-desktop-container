import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { invoke } from "@tauri-apps/api/core";
import { AppStateService } from "./app-state.service";

export interface LogEntry {
  type: 'INFO' | 'ERROR' | 'WARN' | 'SUCCESS' | 'FETCH' | 'XHR';
  message: string;
  timestamp: Date;
  source?: string;
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

  constructor(private appState: AppStateService) {
    this.appState.activeTabId$.subscribe(id => {
      // Normalizar IDs de sistema a App.SDC
      if (['dashboard', 'connections', 'security', 'monitor', 'system'].includes(id)) {
        this.currentAppId = 'App.SDC';
      } else {
        this.currentAppId = id;
      }
    });
  }

  initialize() {
    if (this.initialized) return;
    this.initialized = true;

    // Listen for logs from Iframe Apps (Bridge)
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'SDC_LOG') {
        const payload = event.data.payload;
        const appId = payload.app_id || 'unknown-app';
        const logType = payload.log_type || 'INFO';
        const message = payload.message || '';
        const details = payload.details || null;

        // NO guardamos automáticamente en BD.
        // Se envía al Inspector para revisión y guardado manual.
        // this.persistBackend(logType, message, appId); 

        this.logSubject.next({
          type: logType as any,
          message: message,
          timestamp: new Date(),
          source: appId,
          details: details // Pasamos los detalles estructurados
        });
      }
    });

    // Override console methods
    // console.log = (...args) => {
    //   this.originalConsoleLog.apply(console, args);
    //   this.persistLog('INFO', args.join(' '));
    // };

    console.error = (...args) => {
      this.originalConsoleError.apply(console, args);
      this.persistLog('ERROR', args.join(' '));
    };

    // console.warn = (...args) => {
    //   this.originalConsoleWarn.apply(console, args);
    //   this.persistLog('WARN', args.join(' '));
    // };

    // Intercept Fetch
    // Intercept Fetch
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const [resource, config] = args;
      const url = resource.toString();

      // Skip logging logic for noisy internal calls
      if (url.includes('save_app_log') ||
        url.includes('ipc://') ||
        url.includes('get_system_telemetry')) {
        return originalFetch(...args);
      }

      // NO logueamos el Request de salida para reducir ruido.

      try {
        const response = await originalFetch(...args);

        // Solo reportar errores HTTP (400+) como ERROR
        if (response.status >= 400) {
          this.persistLog('ERROR', `HTTP Error ${response.status} [${config?.method || 'GET'}] ${url}`);
        }

        return response;
      } catch (err: any) {
        this.persistLog('ERROR', `Fetch Exception: ${url} - ${err.message}`);
        throw err;
      }
    };

    this.originalConsoleLog('[LoggerService] Initialized and capturing console/network events.');
  }

  private persistLog(type: 'INFO' | 'ERROR' | 'WARN' | 'SUCCESS' | 'FETCH' | 'XHR', message: string, source: string = 'System') {
    if (message.includes('[LoggerService]') || message.includes('save_app_log')) return;

    // Fix: Usar el ID de la app actual si la fuente es genérica, para que el Inspector lo asocie correctamente
    const effectiveSource = source === 'System' ? this.currentAppId : source;

    const entry: LogEntry = {
      type,
      message,
      timestamp: new Date(),
      source: effectiveSource
    };

    this.logSubject.next(entry);
    // No esperamos aquí para no bloquear la consola, pero se envía al backend
    this.persistBackend(type, message, null, this.currentAppId);
  }

  public async persistBackend(type: string, message: string, details: any, appId: string, timestamp?: string) {
    let backendType = type;
    if (type === 'INFO') backendType = 'LOG';

    try {
      await invoke('save_app_log', {
        log: {
          app_id: appId,
          log_type: backendType,
          message: message,
          details: details,
          timestamp: timestamp
        }
      });
    } catch (err) {
      this.originalConsoleLog('[LoggerService] Failed to persist log:', err);
    }
  }

  // Método manual para logs explícitos
  log(type: 'INFO' | 'ERROR' | 'WARN' | 'SUCCESS', message: string, source: string = 'System') {
    this.persistLog(type, message, source);
  }
}