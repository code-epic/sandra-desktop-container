import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { invoke } from "@tauri-apps/api/core";

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
  selector: 'app-storage',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './storage.component.html',
  styleUrl: './storage.component.css'
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
      this.dbStats = await invoke('get_db_stats');
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
        this.tableColumns = await invoke('get_table_columns', { tableName });
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
      await invoke('clear_app_logs', { appId: null });
      await this.loadDbStats();
      setTimeout(() => {
        this.isDroppingDB = false;
        this.showDropConfirmModal = false;
        this.closeModal();
      }, 1500);
    } catch (err) {
      console.error("Error dropping DB:", err);
      this.isDroppingDB = false;
    }
  }

  closeModal() {
    this.close.emit();
  }
}
