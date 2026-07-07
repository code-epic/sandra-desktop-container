import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import {
  DesktopAppsService,
  DesktopApp,
} from "../../core/services/desktop-apps.service";
import { ModalService } from "../../core/services/modal.service";

@Component({
  selector: "app-desktop-apps",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./apps.component.html",
  styleUrls: ["./apps.component.css"],
})
export class AppsComponent implements OnInit {
  apps: DesktopApp[] = [];

  showModal = false;
  isEditing = false;

  currentApp: DesktopApp = this.getEmptyApp();
  activeTab: 'general' | 'modes' = 'general';

  constructor(
    private appsService: DesktopAppsService,
    private modalService: ModalService
  ) { }

  ngOnInit() {
    this.loadApps();
  }

  async loadApps() {
    try {
      this.apps = await this.appsService.getAllApps();
    } catch (e) {
      console.error("Error loading apps:", e);
    }
  }

  getEmptyApp(): DesktopApp {
    return {
      app_id: "",
      name: "",
      icon: "fas fa-cube",
      is_installed: false,
      is_favorite: false,
      is_proxy_required: false,
      is_external_browser: false,
      is_limitless: false,
      is_csrf_sync: false,
      is_bypass: false,
      repo: "",
      external_url: "",
      base_path: "",
    };
  }

  openAddModal() {
    this.isEditing = false;
    this.currentApp = this.getEmptyApp();
    this.activeTab = 'general';
    this.showModal = true;
  }

  openEditModal(app: DesktopApp) {
    this.isEditing = true;
    this.currentApp = { ...app }; // Clone
    this.activeTab = 'general';
    this.showModal = true;
  }

  closeModal() {
    this.showModal = false;
  }

  // Mutual Exclusion Logic
  toggleProxy() {
    if (this.currentApp.is_proxy_required) {
      this.currentApp.is_external_browser = false;
      this.currentApp.is_limitless = false;
    }
  }

  toggleExternal() {
    if (this.currentApp.is_external_browser) {
      this.currentApp.is_proxy_required = false;
      this.currentApp.is_limitless = false;
    }
  }

  toggleLimitless() {
    if (this.currentApp.is_limitless) {
      this.currentApp.is_proxy_required = false;
      this.currentApp.is_external_browser = false;
      this.currentApp.is_bypass = false;
    }
  }

  toggleCsrfSync() {
    if (this.currentApp.is_csrf_sync) {
      this.currentApp.is_bypass = false;
    }
  }

  toggleBypass() {
    if (this.currentApp.is_bypass) {
      this.currentApp.is_proxy_required = false;
      this.currentApp.is_external_browser = false;
      this.currentApp.is_limitless = false;
      this.currentApp.is_csrf_sync = false;
    }
  }

  showSuccessModal = false;
  successMessage = "";

  // Icon Picker Logic
  showIconPicker = false;
  availableIcons = [
    'fas fa-cube', 'fas fa-layer-group', 'fas fa-box-open',
    'fas fa-file-alt', 'fas fa-file-invoice', 'fas fa-copy',
    'fas fa-users', 'fas fa-user-tie', 'fas fa-id-card',
    'fas fa-chart-line', 'fas fa-chart-pie', 'fas fa-chart-bar',
    'fas fa-cogs', 'fas fa-sliders-h', 'fas fa-tools',
    'fas fa-shield-alt', 'fas fa-lock', 'fas fa-key',
    'fas fa-envelope', 'fas fa-comments', 'fas fa-inbox',
    'fas fa-building', 'fas fa-store', 'fas fa-warehouse',
    'fas fa-globe', 'fas fa-globe-americas', 'fas fa-wifi',
    'fas fa-cloud', 'fas fa-database', 'fas fa-server',
    'fas fa-code', 'fas fa-terminal', 'fas fa-laptop-code',
    'fas fa-calendar-alt', 'fas fa-clock', 'fas fa-check-circle'
  ];

  selectIcon(icon: string) {
    this.currentApp.icon = icon;
    this.showIconPicker = false;
  }

  closeSuccessModal() {
    this.showSuccessModal = false;
    this.loadApps();
  }

  async saveApp() {
    if (!this.currentApp.app_id || !this.currentApp.name) {
      this.modalService.showGenericModal("Validación", "El ID de la Aplicación y el Nombre son requeridos.", "warning");
      return;
    }

    // Normalizar base_path (remover slashes laterales para match en proxy)
    if (this.currentApp.base_path) {
      this.currentApp.base_path = this.currentApp.base_path.trim().replace(/^\/|\/$/g, '');
    }

    try {
      // Ensure booleans are set (fix for first save error)
      this.currentApp.is_proxy_required = !!this.currentApp.is_proxy_required;
      this.currentApp.is_external_browser = !!this.currentApp.is_external_browser;
      this.currentApp.is_limitless = !!this.currentApp.is_limitless;
      this.currentApp.is_csrf_sync = !!this.currentApp.is_csrf_sync;
      this.currentApp.is_bypass = !!this.currentApp.is_bypass;

      if (this.isEditing) {
        await this.appsService.updateApp(this.currentApp);
        this.successMessage = "La aplicación se ha actualizado correctamente.";
      } else {
        await this.appsService.createApp(this.currentApp);
        this.successMessage = "La nueva aplicación ha sido registrada con éxito.";
      }

      this.closeModal();
      this.showSuccessModal = true;
      // this.loadApps() will be called when success modal is closed
    } catch (e) {
      this.modalService.showGenericModal("Error", "Error al guardar la aplicación: " + e, "error");
    }
  }

  showDeleteModal = false;
  appToDelete: DesktopApp | null = null;

  initiateDelete(app: DesktopApp) {
    this.appToDelete = app;
    this.showDeleteModal = true;
  }

  cancelDelete() {
    this.showDeleteModal = false;
    this.appToDelete = null;
  }

  async confirmDelete() {
    if (this.appToDelete) {
      try {
        await this.appsService.deleteApp(this.appToDelete.app_id);
        this.loadApps();
      } catch (e) {
        this.modalService.showGenericModal("Error", "Error al eliminar: " + e, "error");
      }
      this.cancelDelete();
    }
  }
}
