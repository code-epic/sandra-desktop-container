import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { listen } from '@tauri-apps/api/event';
import { DataStreamService } from './data-stream.service';

export interface MailboxMessage {
    id: number;
    sid: string;
    content: string;
    author: string;
    status: 'Pending' | 'Read' | 'Approved' | 'Rejected' | 'Completed';
    tracking_info?: string;
    responsible?: string;
    created_at: string;
    updated_at: string;
    is_read: boolean;
    direction?: 'inbox' | 'outbox';
    attachments?: Array<{
        name: string;
        type: 'PDF' | 'SSE';
        path: string; // Virtual path or ID
    }>;
}

export interface SecurityConfig {
    id: number;
    password_format_regex: string;
    reporting_level: string;
    audit_level: string;
    cache_enabled: boolean;
}

export interface ProxyRoute {
    id: number;
    route_path: string;
    target_database?: string;
    code?: string;
    description?: string;
    is_active: boolean;
}

export interface AuthorizationTicket {
    auth_id: string;
    payload: string;
    content: string;
    status: 'pendiente' | 'en proceso' | 'procesado' | 'notificado';
    created_at: string;
    updated_at: string;
}

@Injectable({
    providedIn: 'root'
})
export class SecurityService {

    // --- Global Sync State (Reactive) ---
    private _isSyncing = new BehaviorSubject<boolean>(false);
    isSyncing$ = this._isSyncing.asObservable();

    private syncStatus = new BehaviorSubject<'idle' | 'syncing' | 'completed' | 'error'>('idle');
    public syncStatus$ = this.syncStatus.asObservable();

    private _syncProgress = new BehaviorSubject<number>(0);
    syncProgress$ = this._syncProgress.asObservable();

    private _syncMessage = new BehaviorSubject<string>('');
    syncMessage$ = this._syncMessage.asObservable();

    private _syncCount = new BehaviorSubject<number>(0);
    syncCount$ = this._syncCount.asObservable();

    private _mailboxRefreshTrigger = new Subject<void>();
    public mailboxRefreshTrigger$ = this._mailboxRefreshTrigger.asObservable();

    private lastProgressUpdate = 0;
    private readonly UI_THROTTLE_MS = 150;
    private existingGuids = new Set<string>();

    constructor(private dataStreamService: DataStreamService) {
        // Escucha global de refresco desde Rust (Remote Control o Sync Interno)
        listen('refresh-mailbox', () => {
            console.log("[Service] Señal de refresco recibida de Rust");
            this._mailboxRefreshTrigger.next();
        });
    }

    setSyncState(syncing: boolean, message: string = '', progress: number = 0, count: number = 0) {
        this._isSyncing.next(syncing);
        this.syncStatus.next(syncing ? 'syncing' : 'completed');
        this._syncMessage.next(message);
        this._syncProgress.next(progress);
        this._syncCount.next(count);
    }

    // --- Mailbox ---
    async getMailboxMessages(): Promise<MailboxMessage[]> {
        return invoke('get_mailbox_messages');
    }

    async syncMailbox(): Promise<string[]> {
        return invoke('sync_mailbox');
    }

    async createMailboxMessage(message: Partial<MailboxMessage>) {
        return invoke('create_mailbox_message', {
            sid: message.sid,
            content: message.content,
            author: message.author,
            responsible: message.responsible,
            direction: message.direction || 'outbox'
        });
    }

    async updateMailboxStatus(id: number, status: string, trackingInfo?: string) {
        return invoke('update_mailbox_status', { id, status, trackingInfo });
    }

    async deleteMailboxMessage(id: number) {
        return invoke('delete_mailbox_message', { id });
    }

    // --- Config ---
    async getSecurityConfig(): Promise<SecurityConfig> {
        return invoke('get_security_config');
    }

    async updateSecurityConfig(config: Partial<SecurityConfig>) {
        // Rust args: password_format_regex, reporting_level, audit_level, cache_enabled
        // Tauri auto-converts camelCase keys to snake_case args
        return invoke('update_security_config', {
            passwordFormatRegex: config.password_format_regex,
            reportingLevel: config.reporting_level,
            auditLevel: config.audit_level,
            cacheEnabled: config.cache_enabled
        });
    }

    // --- Proxy Routes ---
    async getProxyRoutes(): Promise<ProxyRoute[]> {
        return invoke('get_proxy_routes');
    }

    async createProxyRoute(route: Partial<ProxyRoute>) {
        return invoke('create_proxy_route', {
            routePath: route.route_path,
            targetDatabase: route.target_database,
            code: route.code,
            description: route.description
        });
    }

    async deleteProxyRoute(id: number) {
        return invoke('delete_proxy_route', { id });
    }

    // --- Authorization Tickets ---
    async getAuthorizationTickets(): Promise<AuthorizationTicket[]> {
        return invoke('get_authorization_tickets');
    }

    async deleteAuthorizationTicket(authId: string) {
        return invoke('delete_authorization_ticket', { authId });
    }

    async updateAuthorizationTicketStatus(authId: string, status: string) {
        return invoke('update_authorization_ticket_status', { authId, status });
    }

    // --- Sync Methods (Industrial-Scale Streaming) ---

    private activeSyncConnection: any;

    async startMailboxSync(activeConnection: any, authorProfile: any) {
        if (this._isSyncing.value || !activeConnection || !authorProfile?.usuario) return;
        this.activeSyncConnection = activeConnection;

        // Limpiar contador previo y activar visual inmediatamente
        this._syncCount.next(0);
        this.setSyncState(true, 'Iniciando sincronización...', 5, 0);

        // 1. Cargar mensajes locales para de-duplicación
        try {
            const existing = await this.getMailboxMessages();
            this.existingGuids = new Set(existing.map(m => this.getMessageGuid(m.content)?.toLowerCase()).filter((g): g is string => !!g));
            // También añadir los sid por si acaso
            existing.forEach(m => { if(m.sid) this.existingGuids.add(m.sid.toLowerCase()); });
        } catch (e) {
            this.existingGuids = new Set();
        }

        const login = (authorProfile.usuario || 'persona').toLowerCase();
        const sistema = (authorProfile.sistema || 'consola').toLowerCase();
        const mailId = `${login}@${sistema}`;

        const endpoint = `v1/api/crudstream:${activeConnection.hash}`;
        const payload = { "funcion": 'SDC_CMailBoxUser', "parametros": mailId };

        console.log(`[Service] Iniciando Streaming Background para: ${mailId}`);

        this.dataStreamService.streamPostRequest<any>(
            activeConnection.ip_address,
            Number(activeConnection.port),
            endpoint,
            payload,
            activeConnection.hash,
            activeConnection.jwt
        ).subscribe({
            next: async (item) => {
                // ACK Certificado (Acumulado) - Ejecutar primero para sincronizar con el server
                this.certifyDownload(item);

                const itemGuid = (item.manifest?.guid || item.id);
                if (!itemGuid) return;
                
                const guidStr = String(itemGuid).toLowerCase();
                if (this.existingGuids.has(guidStr)) return;

                // Marcar como existente INMEDIATAMENTE 
                this.existingGuids.add(guidStr);

                // Procesar persistencia
                await this.processDownloadedMail(item);

                const count = this._syncCount.value + 1;
                this._syncCount.next(count);

                const now = Date.now();
                if (now - this.lastProgressUpdate > this.UI_THROTTLE_MS || count === 1) {
                    this._syncProgress.next(Math.min((count / 100) * 100, 95));
                    this._syncMessage.next(item.message_envelope?.subject || item.sid || 'Actualizando buzón...');
                    this.lastProgressUpdate = now;
                }
            },
            error: (err) => {
                console.error("Error en streaming service:", err);
                this.setSyncState(false);
            },
            complete: () => {
                this.flushAcks();
                if (this._isSyncing.value) {
                    this._syncProgress.next(100);
                    this._syncMessage.next('Sincronizado');
                    setTimeout(() => this.setSyncState(false), 1200);
                }
            }
        });
    }

    // -- Private Helper Methods --

    private getMessageGuid(content: string): string | null {
        try {
            const parsed = JSON.parse(content);
            return parsed.manifest?.guid || parsed.id || null;
        } catch { return null; }
    }

    private async processDownloadedMail(item: any) {
        if (!item) return;

        // manifest.guid es la CLAVE (sid) para de-duplicación y rastreo auditado
        const guid = item.manifest?.guid || item.id || String(Date.now());
        
        await this.createMailboxMessage({
            sid: String(guid),
            content: JSON.stringify(item),
            author: item.message_envelope?.from || item.message_envelope?.author || item.manifest?.sender || item.author || 'Unknown',
            responsible: item.message_envelope?.to || item.responsible || 'persona.consola',
            direction: 'inbox'
        });
    }

    private certifyDownload(item: any) {
        const id = item.manifest?.guid || item.id;
        if (id) {
            this.pendingAcks.push(String(id));
            if (this.pendingAcks.length >= 25) this.flushAcks();
        }
    }

    private pendingAcks: string[] = [];
    private async flushAcks() {
        if (this.pendingAcks.length === 0 || !this.activeSyncConnection) return;
        
        const acks = [...this.pendingAcks];
        this.pendingAcks = [];
        
        // Formato solicitado: array##"id1","id2",...
        const paramString = `array##${acks.map(id => `"${id}"`).join(',')}`;
        
        const endpoint = `v1/api/crud:${this.activeSyncConnection.hash}`;
        const payload = {
            "funcion": 'SDC_IMailBoxBulk',
            "parametros": paramString
        };

        try {
            await invoke('api_post_request', {
                ip: this.activeSyncConnection.ip_address,
                port: Number(this.activeSyncConnection.port),
                endpoint: endpoint,
                payload: payload,
                hash: this.activeSyncConnection.hash,
                tempAuthToken: this.activeSyncConnection.jwt
            });
            console.log(`[Sync] Batch ACK enviado: ${acks.length} registros.`);
        } catch (e) {
            console.error("Error enviando batch ACKs:", e);
        }
    }
}
