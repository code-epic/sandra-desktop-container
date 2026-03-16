import { Injectable, EventEmitter } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { SafeResourceUrl } from '@angular/platform-browser';

export interface Tab {
  id: string;
  name: string;
  icon: string;
  url?: SafeResourceUrl;
  content?: SafeResourceUrl;      // Content for internal viewers
  blobData?: string;              // Raw Base64/DataUri for saving later
  originalName?: string;          // Filename for saving
  isProtected?: boolean;          // If true, download as SSE
  showToolbar?: boolean;          // Controls visibility of PDF actions
  isSavedToHistory?: boolean;     // If true, hides history button
  zoomLevel?: number;             // Current zoom level for PDF (default 1.0)
  filePath?: string;              // Original file path (required for unlocking)
  isProxyRequired?: boolean;      // If true, proxy is required
  isExternal?: boolean;           // If true, external URL
  isLocked?: boolean;             // New: If true, show unlock UI
  hiddenContent?: string;         // New: Base64 of hidden content (Pages 2+)
  isExternalMode?: boolean;       // If true, use permissive iframe for external browsing
  mimeType?: string;              // Mime type for document viewer
  blobUrl?: string;               // New: URL object for cleaner memory management
  csvHeader?: string[];           // Header columns for CSV viewer
  csvRows?: string[][];           // Data rows for CSV viewer
  csvFilteredRows?: string[][];   // Search results for CSV viewer
  csvVisibleColumns?: string[];   // Visible columns for CSV viewer
  csvSearchCache?: string[];      // Pre-computed lowercase strings for search
  type?: 'iframe' | 'pdf-viewer' | 'file-viewer' | 'csv-viewer';
}

export interface BackgroundTask {
  id: string;
  appId?: string;
  title: string;
  status: 'pending' | 'running' | 'finalizado' | 'error';
  progress: number; // 0 to 100
  message?: string;
  payload?: any;
  timestamp: Date;
  logs?: string[];
  isExpanded?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AppStateService {
  // Estado de los Sidebars
  private leftSidebarOpenSubject = new BehaviorSubject<boolean>(true);
  leftSidebarOpen$ = this.leftSidebarOpenSubject.asObservable();

  private rightSidebarOpenSubject = new BehaviorSubject<boolean>(false);
  rightSidebarOpen$ = this.rightSidebarOpenSubject.asObservable();

  // Estado de los Tabs
  private activeTabIdSubject = new BehaviorSubject<string>('dashboard');
  activeTabId$ = this.activeTabIdSubject.asObservable();

  private openTabsSubject = new BehaviorSubject<Tab[]>([]);
  openTabs$ = this.openTabsSubject.asObservable();

  // Estado Global de Carga
  private globalLoadingSubject = new BehaviorSubject<{ isLoading: boolean, message: string }>({ isLoading: false, message: '' });
  globalLoading$ = this.globalLoadingSubject.asObservable();

  // Tareas en segundo plano
  private backgroundTasksSubject = new BehaviorSubject<BackgroundTask[]>([]);
  backgroundTasks$ = this.backgroundTasksSubject.asObservable();

  // Visibilidad del Chat
  private chatVisibleSubject = new BehaviorSubject<boolean>(true);
  chatVisible$ = this.chatVisibleSubject.asObservable();

  // Eventos
  public onConfigToggle = new EventEmitter<void>();

  setGlobalLoading(isLoading: boolean, message: string = 'Procesando...') {
    this.globalLoadingSubject.next({ isLoading, message });
  }

  toggleLeftSidebar() {
    this.leftSidebarOpenSubject.next(!this.leftSidebarOpenSubject.value);
  }

  setLeftSidebar(isOpen: boolean) {
    if (this.leftSidebarOpenSubject.value !== isOpen) {
      this.leftSidebarOpenSubject.next(isOpen);
    }
  }

  toggleRightSidebar() {
    this.rightSidebarOpenSubject.next(!this.rightSidebarOpenSubject.value);
  }

  setActiveTab(id: string) {
    this.activeTabIdSubject.next(id);
    // Lógica inteligente: mantener sidebar para páginas principales, ocultar para apps
    // Secure Viewer se agrega a estáticas.
    const staticPages = ['dashboard', 'connections', 'apps', 'security', 'monitor', 'secure-viewer'];

    if (!staticPages.includes(id)) {
      this.leftSidebarOpenSubject.next(false);
      this.rightSidebarOpenSubject.next(false);
    } else {
      this.leftSidebarOpenSubject.next(true);
    }
  }

  addTab(tab: Tab) {
    const currentTabs = this.openTabsSubject.value;
    if (!currentTabs.find(t => t.id === tab.id)) {
      this.openTabsSubject.next([...currentTabs, tab]);
    }
    this.setActiveTab(tab.id);
  }

  getTabsSnapshot(): Tab[] {
    return this.openTabsSubject.value;
  }

  closeTab(id: string) {
    const currentTabs = this.openTabsSubject.value.filter(t => t.id !== id);
    this.openTabsSubject.next(currentTabs);
    if (this.activeTabIdSubject.value === id) {
      this.setActiveTab('dashboard');
    }
  }

  // Gestión de Tareas
  addTask(task: BackgroundTask) {
    const current = this.backgroundTasksSubject.value;
    if (!current.find(t => t.id === task.id)) {
      const updated = [...current, { ...task, logs: task.logs || [], isExpanded: false }];
      this.backgroundTasksSubject.next(updated);
      this.updateChatVisibility(updated);
    }
  }

  updateTask(id: string, updates: Partial<BackgroundTask>) {
    const current = this.backgroundTasksSubject.value;
    const index = current.findIndex(t => t.id === id);
    if (index !== -1) {
      const updated = [...current];
      // Si llega un nuevo mensaje, agregarlo a los logs si no está
      const newLogs = updates.message && updated[index].message !== updates.message 
                      ? [...(updated[index].logs || []), updates.message]
                      : updated[index].logs;

      updated[index] = { ...updated[index], ...updates, logs: newLogs };
      this.backgroundTasksSubject.next(updated);
      this.updateChatVisibility(updated);
    }
  }

  addLogToTask(id: string, log: string) {
    const current = this.backgroundTasksSubject.value;
    const index = current.findIndex(t => t.id === id);
    if (index !== -1) {
      const updated = [...current];
      updated[index] = { 
        ...updated[index], 
        logs: [...(updated[index].logs || []), log] 
      };
      this.backgroundTasksSubject.next(updated);
    }
  }

  removeTask(id: string) {
    const updated = this.backgroundTasksSubject.value.filter(t => t.id !== id);
    this.backgroundTasksSubject.next(updated);
    this.updateChatVisibility(updated);
  }

  getTasksSnapshot(): BackgroundTask[] {
    return this.backgroundTasksSubject.value;
  }

  private updateChatVisibility(tasks: BackgroundTask[]) {
    // Si hay cualquier tarea en el modal (incluso finalizada pero visible), ocultamos el chat
    this.chatVisibleSubject.next(tasks.length === 0);
  }
}