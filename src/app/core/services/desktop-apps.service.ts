import { Injectable } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";
import { Subject } from "rxjs";

export interface DesktopApp {
  id?: number;
  app_id: string;
  name: string;
  icon: string;
  repo?: string;
  external_url?: string;
  is_installed: boolean;
  is_favorite: boolean;
  description?: string;
  username?: string;
  password?: string;
  token?: string;
  action?: string; // Optional for mapped actions like 'toggleCP'
}

@Injectable({
  providedIn: "root",
})
export class DesktopAppsService {
  private appsUpdatedSubject = new Subject<void>();
  public appsUpdated$ = this.appsUpdatedSubject.asObservable();

  constructor() {}

  async getAllApps(): Promise<DesktopApp[]> {
    return await invoke<DesktopApp[]>("get_all_apps");
  }

  async createApp(app: DesktopApp): Promise<number> {
    const res = await invoke<number>("create_app", { app });
    this.appsUpdatedSubject.next(); // Notify
    return res;
  }

  async updateApp(app: DesktopApp): Promise<void> {
    await invoke("update_app", { app });
    this.appsUpdatedSubject.next(); // Notify
  }

  async deleteApp(appId: string): Promise<void> {
    await invoke("delete_app", { appId: appId });
    this.appsUpdatedSubject.next(); // Notify
  }

  async verifyAppInstalled(folderName: string): Promise<boolean> {
    return await invoke<boolean>("verify_app_installed", { folderName });
  }
}
