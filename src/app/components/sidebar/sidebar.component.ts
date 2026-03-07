import {
  Component,
  OnInit,
  OnDestroy,
  Output,
  EventEmitter,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { DomSanitizer } from "@angular/platform-browser";
import { AppStateService } from "../../core/services/app-state.service";
import { Observable } from "rxjs";

@Component({
  selector: "app-sidebar",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./sidebar.component.html",
  styleUrls: ["./sidebar.component.css"],
})
export class SidebarComponent implements OnInit, OnDestroy {
  @Output() onLogout = new EventEmitter<void>();
  @Output() onNavigateRequest = new EventEmitter<string>();

  // Observables del estado global
  isOpen$: Observable<boolean>;
  activeTab$: Observable<string>;

  currentDateStr: string = "";
  currentTimeStr: string = "";
  private timerId: any;

  constructor(
    public appState: AppStateService,
    private sanitizer: DomSanitizer,
  ) {
    this.isOpen$ = this.appState.leftSidebarOpen$;
    this.activeTab$ = this.appState.activeTabId$;
  }

  ngOnInit() {
    this.updateDateTime();
    this.timerId = setInterval(() => {
      this.updateDateTime();
    }, 1000);
  }

  ngOnDestroy() {
    if (this.timerId) {
      clearInterval(this.timerId);
    }
  }

  updateDateTime() {
    const now = new Date();
    const months = [
      "ENE",
      "FEB",
      "MAR",
      "ABR",
      "MAY",
      "JUN",
      "JUL",
      "AGO",
      "SEP",
      "OCT",
      "NOV",
      "DIC",
    ];

    const day = now.getDate().toString().padStart(2, "0");
    const month = months[now.getMonth()];
    const year = now.getFullYear().toString().slice(-2);
    this.currentDateStr = `${day}${month}${year}`;

    // Formato HH:mm:ss
    this.currentTimeStr = now.toLocaleTimeString("es-ES", { hour12: false });
  }

  switchToDashboard() {
    this.appState.setActiveTab("dashboard");
  }

  setActive(id: string) {
    this.onNavigateRequest.emit(id);
  }

  toggleConfig() {
    this.appState.onConfigToggle.emit();
  }

  logout() {
    this.onLogout.emit();
  }

  openWikiHelp() {
    const url = this.sanitizer.bypassSecurityTrustResourceUrl(
      "https://code-epic.com/wiki",
    );
    this.appState.addTab({
      id: "wiki-help",
      name: "Ayuda Wiki",
      icon: "fas fa-book",
      // @ts-ignore
      url: url,
      type: "iframe",
      isProxyRequired: false,
      isExternal: true,
    });
  }
}
