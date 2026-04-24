import { Component, EventEmitter, Input, Output, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { invoke } from "@tauri-apps/api/core";

import { POLICIES_HTML } from "../../constants/policies";

@Component({
  selector: "app-setup-wizard",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./setup-wizard.component.html",
  styleUrls: ["./setup-wizard.component.css"],
})
export class SetupWizardComponent implements OnInit {
  @Input() stats: any = null;
  @Input() networkInfo: string[] = [];
  @Output() onComplete = new EventEmitter<any>();

  step = 1;
  policiesAccepted = false;
  hasReadToBottom = false;
  policiesHtml = POLICIES_HTML;

  formData = {
    name: "",
    description: "",
    area: "",
    // Connection Data
    connName: "Sandra Server Principal",
    ip_address: "",
    port: 443,
    wss_host: "",
    wss_port: 8443,
  };

  verifyStatus: "idle" | "checking" | "success" | "error" = "idle";
  isHostAvailable: boolean = false;
  clientId: string = "---";
  hashPreview: string = "Generando...";

  async ngOnInit() {
    try {
      this.clientId = await invoke("get_or_create_client_id");
    } catch (e) {
      console.error("Error loading client ID in wizard", e);
    }
  }

  async next() {
    if (this.step === 1) {
      if (!this.policiesAccepted) return;
      this.step++;
      return;
    }

    if (this.step === 2) {
      if (!this.formData.name || !this.formData.area) {
        return;
      }
      this.step++;
      try {
        this.hashPreview = await invoke("get_hash_preview", {
          accountName: this.formData.name,
        });
      } catch (e) {
        console.error("Error previewing hash", e);
        this.hashPreview = "Error al generar";
      }
      return;
    }

    if (this.step < 4) {
      this.step++;
    } else {
      this.finish();
    }
  }

  back() {
    if (this.step > 1) {
      this.step--;
    }
  }

  // --- Host Verification (Copied from ConnectionsComponent) ---
  private debounceTimer: any;
  onAddressChange() {
    if (this.formData.ip_address) {
      this.formData.ip_address = this.formData.ip_address.toLowerCase();
    }
    this.verifyStatus = "idle";
    this.isHostAvailable = false;

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.formData.ip_address.length < 3) return;

    this.debounceTimer = setTimeout(() => {
      this.verifyHost();
    }, 800);
  }

  async verifyHost() {
    this.verifyStatus = "checking";
    try {
      const isUp = await invoke<boolean>("verify_connection_status", {
        ip: this.formData.ip_address,
        port: Number(this.formData.port),
      });

      if (isUp) {
        this.verifyStatus = "success";
        this.isHostAvailable = true;
        // Auto-fill WSS Host on successful validation
        this.formData.wss_host = this.formData.ip_address;
      } else {
        this.verifyStatus = "error";
        this.isHostAvailable = false;
      }
    } catch (err) {
      this.verifyStatus = "error";
      this.isHostAvailable = false;
    }
  }

  copyHash() {
    navigator.clipboard.writeText(this.hashPreview).then(() => {
      // Optional: visual feedback
    });
  }

  onPoliciesScroll(event: any) {
    const element = event.target;
    const isAtBottom = element.scrollHeight - element.scrollTop <= element.clientHeight + 10;
    const hasScrolled = element.scrollTop > 10;
    const isScrollable = element.scrollHeight > element.clientHeight;

    // Only activate if they actually scrolled and reached the end
    if (isScrollable && hasScrolled && isAtBottom) {
      this.hasReadToBottom = true;
      this.policiesAccepted = true; 
    }
  }

  finish() {
    if (!this.formData.name || !this.formData.area) {
      alert("Por favor complete el nombre y área del equipo.");
      this.step = 1;
      return;
    }

    if (!this.formData.ip_address) {
      alert("Debe configurar la dirección del servidor.");
      this.step = 4;
      return;
    }

    this.onComplete.emit(this.formData);
  }
}
