import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { FormsModule } from '@angular/forms';
import { SecurityService, MailboxMessage, AuthorizationTicket } from '../../core/services/security.service';
import { AppStateService } from '../../core/services/app-state.service';

interface MonitorSdcConfig {
    access: {
        jwtStorage: 'localStorage' | 'sessionStorage';
        jwtVariableName: string;
    };
}

interface MonitorLog {
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
export class MonitorComponent implements OnInit, OnDestroy {
    activeTab: 'logs' | 'tickets' = 'tickets';

    // Logs Data
    logs: MonitorLog[] = [];
    loading = false;
    filterText = '';
    apps: string[] = ['App.SDC'];
    currentAppFilter = 'all';
    currentUserLogin: string = 'default';




    // Tickets Data
    tickets: AuthorizationTicket[] = [];
    loadingTickets = false;
    ticketStatusFilter: string = 'pendiente';
    selectedTicket: AuthorizationTicket | null = null;

    constructor(
        private securityService: SecurityService,
        private appState: AppStateService
    ) { }

    currentTime: Date = new Date();
    private timeInterval: any;

    async ngOnInit() {
        if (!this.checkAuth()) return;

        await this.loadInstalledApps();
        this.refreshAll();

        // Escuchar eventos globales de actualización
        listen('refresh-monitor-data', () => {
            this.refreshAll();
            // Si hay un ticket seleccionado, refrescar sus datos locales
            if (this.selectedTicket) {
                const updated = this.tickets.find(t => t.auth_id === this.selectedTicket?.auth_id);
                if (updated) {
                    this.selectedTicket = { ...updated };
                }
            }
        });

        // Actualizador de tiempo en vivo
        this.timeInterval = setInterval(() => {
            if (this.activeTab === 'tickets') {
                this.currentTime = new Date();
            }
        }, 1000);
    }

    private checkAuth(): boolean {
        const configStr = localStorage.getItem('sdc_ui_config');
        const isRealJwt = (t: any) => t && t.length > 20 && t.includes('.');

        if (configStr) {
            try {
                const config: MonitorSdcConfig = JSON.parse(configStr);
                const storage = config.access.jwtStorage === 'sessionStorage' ? sessionStorage : localStorage;
                const token = storage.getItem(config.access.jwtVariableName);

                if (!isRealJwt(token)) {
                    console.warn("Monitor: Acceso denegado. Token no válido o sesión no activa.");
                    this.appState.setActiveTab('dashboard');
                    return false;
                }

                // Extraer usuario del JWT para filtrado de datos
                try {
                    if (token) {
                        const payload = JSON.parse(atob(token.split('.')[1]));
                        this.currentUserLogin = payload.Usuario?.['usuario'] || payload.usuario || 'default';
                    }
                } catch (e) {
                    this.currentUserLogin = 'default';
                }
            } catch (e) {
                console.error("Error validando auth en Monitor", e);
                this.appState.setActiveTab('dashboard');
                return false;
            }
        } else {
            console.warn("Monitor: Configuración no encontrada.");
            this.appState.setActiveTab('dashboard');
            return false;
        }
        return true;
    }

    ngOnDestroy() {
        if (this.timeInterval) {
            clearInterval(this.timeInterval);
        }
    }

    async refreshAll() {
        await Promise.all([
            this.refreshLogs(),
            this.loadTickets()
        ]);
    }



    async loadTickets() {
        this.loadingTickets = true;
        try {
            const result = await this.securityService.getAuthorizationTickets(this.currentUserLogin);
            this.tickets = result.map(t => {
                if (t.created_at && t.created_at.length === 19 && t.created_at.includes(' ')) {
                    t.created_at = t.created_at.replace(' ', 'T') + 'Z';
                }
                return t;
            });
        } catch (error) {
            console.error('Error loading tickets:', error);
        } finally {
            this.loadingTickets = false;
        }
    }

    setTab(tab: 'logs' | 'tickets') {
        this.activeTab = tab;
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
            let appsToFetch = this.currentAppFilter === 'all' ? this.apps : [this.currentAppFilter];
            let allLogs: MonitorLog[] = [];

            for (const appId of appsToFetch) {
                const appLogs = await invoke<MonitorLog[]>('get_app_logs', { 
                    appId,
                    userLogin: this.securityService.getCurrentUserLogin()
                });
                allLogs = [...allLogs, ...appLogs];
            }

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

    selectedLog: MonitorLog | null = null;
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

    viewLogDetails(log: MonitorLog) {
        this.selectedLog = log;
    }

    closeModal() {
        this.selectedLog = null;
    }

    get filteredTickets() {
        if (this.ticketStatusFilter === 'all') return this.tickets;
        return this.tickets.filter(t => (t.status || '').toLowerCase() === this.ticketStatusFilter.toLowerCase());
    }

    getTimeElapsed(dateStr: string | undefined): string {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        const diffMs = this.currentTime.getTime() - date.getTime();
        if (diffMs < 0) return '00:00';

        const diffSecsTotal = Math.floor(diffMs / 1000);
        const diffMins = Math.floor(diffSecsTotal / 60);
        const diffSecs = diffSecsTotal % 60;

        return `${diffMins.toString().padStart(2, '0')}:${diffSecs.toString().padStart(2, '0')}`;
    }

    ticketToDelete: AuthorizationTicket | null = null;
    isDeleteModalOpen = false;

    requestDeleteTicket(ticket: AuthorizationTicket) {
        this.ticketToDelete = ticket;
        this.isDeleteModalOpen = true;
    }

    cancelDeleteTicket() {
        this.ticketToDelete = null;
        this.isDeleteModalOpen = false;
    }

    async confirmDeleteTicket() {
        if (!this.ticketToDelete) return;
        this.securityService.playDeleteSound();
        try {
            await this.securityService.deleteAuthorizationTicket(this.ticketToDelete.auth_id);
            await this.loadTickets();
            await emit('refresh-monitor-data');
        } catch (error) {
            console.error('Error deleting ticket:', error);
        } finally {
            this.cancelDeleteTicket();
        }
    }

    async updateTicketStatus(authId: string, status: any) {
        try {
            await this.securityService.updateAuthorizationTicketStatus(authId, status);
            await this.loadTickets();
            await emit('refresh-monitor-data');
        } catch (error) {
            console.error('Error updating ticket status:', error);
        }
    }

    viewTicketDetails(ticket: AuthorizationTicket) {
        this.selectedTicket = ticket;
    }

    closeTicketModal() {
        this.selectedTicket = null;
    }

    formatJson(jsonStr: string): string {
        try {
            return JSON.stringify(JSON.parse(jsonStr), null, 2);
        } catch {
            return jsonStr;
        }
    }

    getTruncatedContent(text: string, maxLines: number = 5): string {
        if (!text) return '';
        const lines = text.split('\n');
        if (lines.length <= maxLines) return text;
        return lines.slice(0, maxLines).join('\n');
    }

    hasMoreLines(text: string, maxLines: number = 5): boolean {
        if (!text) return false;
        return text.split('\n').length > maxLines;
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
