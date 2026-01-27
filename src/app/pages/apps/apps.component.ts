import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import {
  DesktopAppsService,
  DesktopApp,
} from "../../core/services/desktop-apps.service";

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

  constructor(private appsService: DesktopAppsService) {}

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
      repo: "",
      external_url: "",
    };
  }

  openAddModal() {
    this.isEditing = false;
    this.currentApp = this.getEmptyApp();
    this.showModal = true;
  }

  openEditModal(app: DesktopApp) {
    this.isEditing = true;
    this.currentApp = { ...app }; // Clone
    this.showModal = true;
  }

  closeModal() {
    this.showModal = false;
  }

  async saveApp() {
    if (!this.currentApp.app_id || !this.currentApp.name) {
      alert("App ID and Name are required");
      return;
    }

    try {
      if (this.isEditing) {
        await this.appsService.updateApp(this.currentApp);
      } else {
        await this.appsService.createApp(this.currentApp);
      }
      this.closeModal();
      this.loadApps();
    } catch (e) {
      alert("Error saving app: " + e);
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
        alert("Error deleting: " + e);
      }
      this.cancelDelete();
    }
  }
}
