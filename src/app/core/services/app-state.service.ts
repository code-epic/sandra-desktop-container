import { Injectable, EventEmitter } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { SafeResourceUrl } from '@angular/platform-browser';

export interface Tab {
  id: string;
  name: string;
  icon: string;
  url?: SafeResourceUrl;
  type?: 'iframe' | 'pdf-viewer'; // New field for Secure Viewer tabs
  content?: SafeResourceUrl;      // Content for internal viewers
  blobData?: string;              // Raw Base64/DataUri for saving later
  originalName?: string;          // Filename for saving
  isProtected?: boolean;          // If true, download as SSE
  showToolbar?: boolean;          // Controls visibility of PDF actions
  isSavedToHistory?: boolean;     // If true, hides history button
  zoomLevel?: number;             // Current zoom level for PDF (default 1.0)
  filePath?: string;              // Original file path (required for unlocking)
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

  // Eventos
  public onConfigToggle = new EventEmitter<void>();

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
}