import { Component, EventEmitter, OnInit, Output } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ModalComponent } from "../modal/modal.component";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

export interface DbStats {
  connected: boolean;
  table_count: number;
  tables: string[];
}

export interface ColumnInfo {
  name: string;
  type_: string;
}

@Component({
  selector: "app-storage",
  standalone: true,
  imports: [CommonModule, ModalComponent],
  templateUrl: "./storage.component.html",
  styleUrl: "./storage.component.css",
})
export class StorageComponent implements OnInit {
  @Output() close = new EventEmitter<void>();

  dbStats: DbStats | null = null;
  expandedTable: string | null = null;
  tableColumns: ColumnInfo[] = [];

  showDropConfirmModal = false;
  isDroppingDB = false;

  async ngOnInit() {
    await this.loadDbStats();
  }

  async loadDbStats() {
    try {
      this.dbStats = await invoke("get_db_stats");
    } catch (err) {
      console.error("Error DB stats:", err);
    }
  }

  async toggleTable(tableName: string) {
    if (this.expandedTable === tableName) {
      this.expandedTable = null;
      this.tableColumns = [];
    } else {
      this.expandedTable = tableName;
      try {
        this.tableColumns = await invoke("get_table_columns", { tableName });
      } catch (err) {
        console.error("Error loading columns:", err);
      }
    }
  }

  requestDropDB() {
    this.showDropConfirmModal = true;
  }

  cancelDropDB() {
    this.showDropConfirmModal = false;
  }

  async dropDB() {
    this.isDroppingDB = true;
    try {
      // Ahora llamamos al comando real de reseteo completo
      await invoke("reset_database");

      // Esperamos un poco para que se note la acción
      setTimeout(async () => {
        await this.loadDbStats(); // Recargar stats (debería estar casi vacío pero con la data default)
        this.isDroppingDB = false;
        this.showDropConfirmModal = false;
        this.closeModal();
      }, 1500);
    } catch (err) {
      console.error("Error dropping DB:", err);
      this.isDroppingDB = false;
    }
  }

  showExportConfirmModal = false;
  exportStep: "confirm" | "loading" | "ready" = "confirm";

  requestExportDB() {
    this.showExportConfirmModal = true;
    this.exportStep = "confirm";
  }

  cancelExportDB() {
    this.showExportConfirmModal = false;
    this.exportStep = "confirm";
  }

  generateBackup() {
    this.exportStep = "loading";

    // Simulamos el proceso de "Generación" del backup
    setTimeout(() => {
      this.exportStep = "ready";
    }, 2000);
  }

  async downloadBackup() {
    console.log("Iniciando descarga de backup...");
    try {
      console.log("Abriendo diálogo de guardado...");
      const filePath = await save({
        defaultPath: "sdc_backup.db",
        filters: [
          {
            name: "SQLite Database",
            extensions: ["db", "sqlite"],
          },
        ],
      });
      console.log("Resultado del diálogo:", filePath);

      if (filePath) {
        console.log("Guardando en:", filePath);
        await invoke("export_database", { targetPath: filePath });
        console.log("Exportación completada en backend");
        alert("Archivo guardado exitosamente.");
        this.closeModal();
      } else {
        console.log("Diálogo cancelado por el usuario");
      }
    } catch (error) {
      console.error("Error exporting DB (Catch):", error);
      alert("Error al exportar la base de datos: " + error);
    }
  }

  closeModal() {
    this.close.emit();
  }
}
