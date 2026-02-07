import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { invoke } from "@tauri-apps/api/core";
import { FormsModule } from '@angular/forms';

interface AppLog {
    id?: number;
    app_id: string;
    log_type: string;
    message: string;
    timestamp?: string;
    details?: any;
}

@Component({
    selector: 'app-monitor',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './monitor.component.html',
    styleUrls: ['./monitor.component.css']
})
export class MonitorComponent implements OnInit {
    logs: AppLog[] = [];
    loading = false;
    filterText = '';
    apps: string[] = ['App.SDC'];
    currentAppFilter = 'all';

    async ngOnInit() {
        await this.loadInstalledApps();
        this.refreshLogs();
    }

    async loadInstalledApps() {
        try {
            const installedApps = await invoke<any[]>('get_all_apps');
            if (installedApps && Array.isArray(installedApps)) {
                const dynamicIds = installedApps
                    .map(a => a.app_id)
                    .filter(id => id && id !== 'App.SDC');

                // Merge uniquely
                this.apps = Array.from(new Set(['App.SDC', ...dynamicIds]));
            }
        } catch (error) {
            console.error('Error loading installed apps for Monitor:', error);
        }
    }

    async refreshLogs() {
        this.loading = true;
        this.logs = [];

        try {
            // Si selecciona 'all', buscamos en todas las apps conocidas.
            let appsToFetch = this.currentAppFilter === 'all' ? this.apps : [this.currentAppFilter];
            let allLogs: AppLog[] = [];

            for (const appId of appsToFetch) {
                const appLogs = await invoke<AppLog[]>('get_app_logs', { appId });
                allLogs = [...allLogs, ...appLogs];
            }


            // Ordenar por fecha descendente
            this.logs = allLogs.sort((a, b) => {
                const dateA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                const dateB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                return dateB - dateA;
            });

        } catch (error) {
            console.error("Error cargando logs en monitor:", error);
        } finally {
            this.loading = false;
        }
    }

    selectedLog: AppLog | null = null;
    isConfirmModalOpen = false;
    isTransferModalOpen = false;

    requestClearLogs() {
        this.isConfirmModalOpen = true;
    }

    cancelClearLogs() {
        this.isConfirmModalOpen = false;
    }

    async confirmClearLogs() {
        this.isConfirmModalOpen = false;
        this.loading = true;
        try {
            for (const appId of this.apps) {
                await invoke('clear_app_logs', { appId });
            }
            await this.refreshLogs();
        } catch (err) {
            console.error("Error limpiando logs", err);
        } finally {
            this.loading = false;
        }
    }

    async dropDB() {
        this.isConfirmModalOpen = false;
        this.loading = true;
        try {
            await invoke('clear_app_logs', { appId: null });
            await this.refreshLogs();
        } catch (err) {
            console.error("Error limpiando logs", err);
        } finally {
            this.loading = false;
        }
    }

    openTransferModal() {
        this.isTransferModalOpen = true;
    }

    closeTransferModal() {
        this.isTransferModalOpen = false;
    }

    confirmTransfer() {
        console.log('Iniciando transferencia de reporte...');
        this.isTransferModalOpen = false;
    }

    viewLogDetails(log: AppLog) {
        console.info(log)
        this.selectedLog = log;
    }

    closeModal() {
        this.selectedLog = null;
    }

    get filteredLogs() {
        if (!this.filterText) return this.logs;
        return this.logs.filter(l =>
            l.message.toLowerCase().includes(this.filterText.toLowerCase()) ||
            l.app_id.toLowerCase().includes(this.filterText.toLowerCase()) ||
            l.log_type.toLowerCase().includes(this.filterText.toLowerCase())
        );
    }
}
