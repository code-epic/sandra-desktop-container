import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { invoke } from "@tauri-apps/api/core";
import { FormsModule } from '@angular/forms';
import { SecurityService, MailboxMessage, AuthorizationTicket } from '../../core/services/security.service';

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
export class MonitorComponent implements OnInit, OnDestroy {
    activeTab: 'logs' | 'notifications' | 'tickets' = 'logs';

    // Logs Data
    logs: AppLog[] = [];
    loading = false;
    filterText = '';
    apps: string[] = ['App.SDC'];
    currentAppFilter = 'all';

    // Notifications Data
    notifications: MailboxMessage[] = [];
    loadingNotifications = false;

    // Tickets Data
    tickets: AuthorizationTicket[] = [];
    loadingTickets = false;
    ticketStatusFilter: string = 'all';
    selectedTicket: AuthorizationTicket | null = null;

    constructor(private securityService: SecurityService) { }

    currentTime: Date = new Date();
    private timeInterval: any;

    async ngOnInit() {
        await this.loadInstalledApps();
        this.refreshAll();
        
        // Actualizador de tiempo en vivo
        this.timeInterval = setInterval(() => {
            if (this.activeTab === 'tickets') {
                this.currentTime = new Date();
            }
        }, 1000);
    }

    ngOnDestroy() {
        if (this.timeInterval) {
            clearInterval(this.timeInterval);
        }
    }

    async refreshAll() {
        await Promise.all([
            this.refreshLogs(),
            this.loadNotifications(),
            this.loadTickets()
        ]);
    }

    async loadNotifications() {
        this.loadingNotifications = true;
        try {
            const result = await this.securityService.getMailboxMessages();
            this.notifications = result.map(n => {
                if (n.created_at && n.created_at.length === 19 && n.created_at.includes(' ')) {
                    n.created_at = n.created_at.replace(' ', 'T') + 'Z';
                }
                return n;
            });
        } catch (error) {
            console.error('Error loading notifications:', error);
        } finally {
            this.loadingNotifications = false;
        }
    }

    async loadTickets() {
        this.loadingTickets = true;
        try {
            const result = await this.securityService.getAuthorizationTickets();
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

    setTab(tab: 'logs' | 'notifications' | 'tickets') {
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

    get filteredTickets() {
        if (this.ticketStatusFilter === 'all') return this.tickets;
        return this.tickets.filter(t => t.status === this.ticketStatusFilter);
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
        try {
            await this.securityService.deleteAuthorizationTicket(this.ticketToDelete.auth_id);
            await this.loadTickets();
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

    get filteredLogs() {
        if (!this.filterText) return this.logs;
        return this.logs.filter(l =>
            l.message.toLowerCase().includes(this.filterText.toLowerCase()) ||
            l.app_id.toLowerCase().includes(this.filterText.toLowerCase()) ||
            l.log_type.toLowerCase().includes(this.filterText.toLowerCase())
        );
    }
}
