import { Injectable, Renderer2, RendererFactory2 } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";

export enum PerformanceProfile {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
}

@Injectable({
  providedIn: "root",
})
export class PerformanceService {
  private renderer: Renderer2;
  private currentProfile: PerformanceProfile = PerformanceProfile.HIGH;
  private isAutoDetected = true;

  constructor(rendererFactory: RendererFactory2) {
    this.renderer = rendererFactory.createRenderer(null, null);
  }

  /**
   * Initializes the performance engine by detecting hardware capabilities.
   */
  async initialize() {
    const savedMode = localStorage.getItem("sandra_perf_mode");

    if (savedMode && savedMode !== "auto") {
      this.isAutoDetected = false;
      this.applyProfile(savedMode as PerformanceProfile);
      return;
    }

    try {
      const stats: any = await invoke("get_system_telemetry");
      // total_memory is in bytes. 4GB = 4 * 1024 * 1024 * 1024 = 4294967296
      const totalRamMB = stats.total_memory / (1024 * 1024);

      // console.log(`🚀 [Performance] Detected Total RAM: ${totalRamMB.toFixed(0)}MB`);

      if (totalRamMB < 4000) {
        // Legacy threshold (Computers < 4GB)
        this.applyProfile(PerformanceProfile.LOW);
      } else if (totalRamMB < 8000) {
        this.applyProfile(PerformanceProfile.MEDIUM);
      } else {
        this.applyProfile(PerformanceProfile.HIGH);
      }
    } catch (e) {
      console.error("Error auto-detecting hardware performance", e);
      this.applyProfile(PerformanceProfile.HIGH); // Fallback to safe high
    }
  }

  /**
   * Applies a performance profile by adding/removing CSS classes from the body.
   */
  applyProfile(profile: PerformanceProfile) {
    this.currentProfile = profile;

    // Remove all possible perf classes
    this.renderer.removeClass(document.body, "perf-low");
    this.renderer.removeClass(document.body, "perf-medium");
    this.renderer.removeClass(document.body, "perf-high");

    // Add current class
    this.renderer.addClass(document.body, `perf-${profile}`);

    // console.log(`🛡️ [Performance] Profile Applied: ${profile.toUpperCase()}`);
  }

  getCurrentProfile(): PerformanceProfile {
    return this.currentProfile;
  }

  setManualProfile(profile: PerformanceProfile | "auto") {
    if (profile === "auto") {
      localStorage.setItem("sandra_perf_mode", "auto");
      this.initialize();
    } else {
      localStorage.setItem("sandra_perf_mode", profile);
      this.applyProfile(profile);
    }
  }
}
