import {
  Component,
  EventEmitter,
  OnInit,
  Output,
  OnDestroy,
  ChangeDetectorRef,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Connection {
  id?: number;
  name: string;
  ip_address: string;
  port: number;
  username?: string;
  password?: string;
  last_connected?: string;
  wss_host?: string;
  wss_port?: number;
  is_connected?: boolean;
}

@Component({
  selector: "app-connections",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./connections.component.html",
  styleUrls: ["./connections.component.css"],
})
export class ConnectionsComponente implements OnInit, OnDestroy {
  // Identity
  clientId: string = "---";
  localIp: string = "---";

  // List
  savedConnections: Connection[] = [];

  // Form
  form: Connection = {
    name: "Nueva Conexión",
    ip_address: "",
    port: 22,
    username: "",
    password: "",
  };

  // Logic State
  verifyStatus: "idle" | "checking" | "success" | "error" = "idle";
  isHostAvailable: boolean = false;
  connectionState: "disconnected" | "connecting" | "connected" | "error" =
    "disconnected";

  // Modal State
  showModal: boolean = false;
  connProgress: number = 0;
  connStatusMsg: string = "";

  // Confetti Modal
  showWelcomeModal: boolean = false;

  // Generic Feedback Modal
  showFeedbackModal: boolean = false;
  feedbackType: "success" | "info" | "error" = "info";
  feedbackTitle: string = "";
  feedbackMessage: string = "";

  // Confirm Modal
  showConfirmModal: boolean = false;
  confirmTitle: string = "";
  confirmMessage: string = "";
  pendingAction: (() => void) | null = null;
  confirmBtnParams: { text: string; class: string; icon: string } = {
    text: "Confirmar",
    class: "btn-modal-confirm",
    icon: "fa-check",
  };

  private unlistenFn: any;

  constructor(private cdr: ChangeDetectorRef) {}

  requestConfirm(
    title: string,
    msg: string,
    action: () => void,
    btnParams?: any,
  ) {
    this.confirmTitle = title;
    this.confirmMessage = msg;
    this.pendingAction = action;
    if (btnParams) {
      this.confirmBtnParams = btnParams;
    } else {
      this.confirmBtnParams = {
        text: "Confirmar",
        class: "btn-modal-confirm",
        icon: "fa-check",
      };
    }
    this.showConfirmModal = true;
  }

  executeConfirm() {
    if (this.pendingAction) this.pendingAction();
    this.closeConfirm();
  }

  closeConfirm() {
    this.showConfirmModal = false;
    this.pendingAction = null;
  }

  async ngOnInit() {
    this.loadSystemData();
    this.loadSavedConnections();

    // Listen to global connection status
    this.unlistenFn = await listen("connection-status", (event: any) => {
      const status = event.payload as string; // connecting, connected, disconnected, error
      // console.log('Connection Status Event:', status);

      this.connectionState = status as any;

      if (status === "connecting") {
        this.showModal = true;
        this.connStatusMsg = "Estableciendo enlace seguro...";
        this.connProgress = 30;
      } else if (status === "connected") {
        this.connProgress = 100;
        this.connStatusMsg = "¡Conectado!";
        setTimeout(() => {
          this.showModal = false;
          this.showWelcomeModal = true;
          this.loadSavedConnections().then(() => this.syncFormStatus()); // Sync UI
        }, 800);
      } else if (status === "error") {
        this.connStatusMsg = "Error en la conexión.";
        this.verifyStatus = "error";
        setTimeout(() => {
          this.showModal = false;
        }, 2000);
        this.loadSavedConnections().then(() => this.syncFormStatus());
      } else if (status === "disconnected") {
        this.loadSavedConnections().then(() => this.syncFormStatus());
      }
      this.cdr.detectChanges();
    });
  }

  // Sync the currently edited form with the updated list status
  syncFormStatus() {
    if (!this.form.id) return;
    const updated = this.savedConnections.find((c) => c.id === this.form.id);
    if (updated) {
      this.form.is_connected = updated.is_connected;
    }
  }

  ngOnDestroy() {
    if (this.unlistenFn) this.unlistenFn();
  }

  async loadSystemData() {
    try {
      this.clientId = await invoke("get_or_create_client_id");
      this.localIp = await invoke("get_local_ip");
    } catch (error) {
      console.error("Failed to load system data", error);
    }
  }

  copyId() {
    navigator.clipboard.writeText(this.clientId);
  }

  async loadSavedConnections() {
    try {
      this.savedConnections = await invoke("get_connections");
    } catch (error) {
      console.error("Failed to load connections", error);
    }
  }

  // --- Verification Logic ---
  private debounceTimer: any;
  onAddressChange() {
    // Enforce lowercase
    if (this.form.ip_address) {
      this.form.ip_address = this.form.ip_address.toLowerCase();
    }

    this.verifyStatus = "idle";
    this.isHostAvailable = false;

    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    // Validar ip basico
    if (this.form.ip_address.length < 3) return;

    this.debounceTimer = setTimeout(() => {
      this.verifyHost();
    }, 800);
  }

  async verifyHost() {
    this.verifyStatus = "checking";
    try {
      const isUp = await invoke("verify_connection_status", {
        ip: this.form.ip_address,
        port: Number(this.form.port),
      });

      if (isUp) {
        this.verifyStatus = "success";
        this.isHostAvailable = true;
      } else {
        this.verifyStatus = "error";
        this.isHostAvailable = false;
      }
    } catch (err) {
      this.verifyStatus = "error";
      this.isHostAvailable = false;
    }
  }

  // --- CRUD ---
  selectConnection(conn: Connection) {
    this.form = { ...conn }; // Copy
    this.verifyHost(); // Re-verify selected
  }

  resetForm() {
    this.form = {
      name: "Nueva Conexión",
      ip_address: "",
      port: 22,
      username: "",
      password: "",
    };
    this.form.id = undefined;
    this.verifyStatus = "idle";
  }

  async save() {
    if (!this.form.name || !this.form.ip_address) return;
    try {
      const isUpdate = !!this.form.id;
      await invoke("save_connection", { connData: this.form });
      await this.loadSavedConnections();

      this.openFeedback(
        "success",
        isUpdate ? "Actualizado" : "Guardado",
        `El perfil "${this.form.name}" ha sido ${isUpdate ? "actualizado" : "creado"} correctamente.`,
      );
    } catch (err: any) {
      console.error(err);
      this.openFeedback("error", "Error", "No se pudo guardar: " + err);
    }
  }

  async deleteConn(e: Event, id: number) {
    e.stopPropagation();

    this.requestConfirm(
      "Eliminar Conexión",
      "¿Estás seguro de que deseas eliminar este perfil de conexión permanentemente?",
      async () => {
        try {
          await invoke("delete_connection", { id });
          await this.loadSavedConnections();
          if (this.form.id === id) this.resetForm();
          this.openFeedback(
            "success",
            "Eliminado",
            "La conexión ha sido eliminada.",
          );
        } catch (err) {
          console.error(err);
          this.openFeedback("error", "Error", "No se pudo eliminar: " + err);
        }
      },
      {
        text: "Eliminar",
        class: "btn-modal-confirm connected-btn",
        icon: "fa-trash",
      },
    );
  }

  // --- Connect/Disconnect Action ---
  async connect() {
    // Toggle Logic based on SPECIFIC connection status
    if (this.form.is_connected) {
      await this.disconnect();
      return;
    }

    // "Probar Conexión" imply explicit intent.
    // If verifyStatus is error, warn but allow? Or block?
    // User complaint: "sale automaticamente error y no es cierto"
    // So we will ALLOW correct attempt even if verify failed (maybe ICMP blocked but WSS open).

    // Warn if empty
    if (!this.form.ip_address) return;

    try {
      this.connectionState = "connecting";

      // If we are just "Testing" (no ID), this might fail if backend requires ID?
      // Backend connects using the struct, ID is optional for update but Connect usually works.

      await invoke("connect_to_server", {
        connData: this.form,
        clientId: this.clientId,
      });
    } catch (err) {
      console.error("Failed to trigger connection", err);
      this.connectionState = "error";
      this.connStatusMsg = "Error al iniciar: " + err;
      this.showModal = true;
      setTimeout(() => (this.showModal = false), 2500);
    }
  }

  async disconnect() {
    this.requestConfirm(
      "Desconectar",
      "¿Desea cerrar la conexión segura con " + this.form.name + "?",
      async () => {
        try {
          await invoke("disconnect_from_server", {
            connData: this.form,
            clientId: this.clientId,
          });
          // State update handled by listener...
          this.openFeedback(
            "info",
            "Desconectado",
            `Conexión cerrada con ${this.form.name}`,
          );
        } catch (err: any) {
          console.error("Failed to disconnect", err);
          this.openFeedback("error", "Error", "Fallo al desconectar: " + err);
        }
      },
      {
        text: "Desconectar",
        class: "btn-modal-confirm connected-btn",
        icon: "fa-unlink",
      },
    );
  }

  openFeedback(type: "success" | "info" | "error", title: string, msg: string) {
    this.feedbackType = type;
    this.feedbackTitle = title;
    this.feedbackMessage = msg;
    this.showFeedbackModal = true;
  }

  closeFeedback() {
    this.showFeedbackModal = false;
  }

  closeWelcome() {
    this.showWelcomeModal = false;
  }
}
