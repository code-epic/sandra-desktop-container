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
    user_login?: string;
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
        listen('refresh-mailbox', async () => {
            console.log("[Service] Señal de refresco recibida de Rust");

            // Despachar sonido doble de notificación (Refuerzo auditivo)
            this.playDoubleNotificationSound();

            this._mailboxRefreshTrigger.next();
        });
    }

    playDeleteSound() {
        try {
            const ctx = this.getAudioContext();
            if (!ctx) return;
            const now = ctx.currentTime;
            
            const playTone = (freq: number, startTime: number, vol: number, dur: number, type: OscillatorType = 'sine') => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = type;
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.setValueAtTime(freq, startTime);
                osc.frequency.exponentialRampToValueAtTime(freq * 0.5, startTime + dur);
                gain.gain.setValueAtTime(0, startTime);
                gain.gain.linearRampToValueAtTime(vol, startTime + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.001, startTime + dur);
                osc.start(startTime);
                osc.stop(startTime + dur);
            };

            // Triple-Action Slate Delete Sound (Efecto De-rez)
            // 1. Pulso inicial seco (Pop)
            playTone(220, now, 0.08, 0.1, 'square');
            // 2. Pulso medio (Thud)
            playTone(110, now + 0.05, 0.12, 0.2, 'sine');
            // 3. Resonancia final (Dissolve)
            playTone(55, now + 0.12, 0.1, 0.4, 'sine');
        } catch {}
    }

    private playDoubleNotificationSound() {
        try {
            const ctx = this.getAudioContext();
            if (!ctx) return;
            
            const playTone = (freq: number, startTime: number, vol: number, dur: number) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.setValueAtTime(freq, startTime);
                gain.gain.setValueAtTime(0, startTime);
                gain.gain.linearRampToValueAtTime(vol, startTime + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, startTime + dur);
                osc.start(startTime);
                osc.stop(startTime + dur);
            };

            const now = ctx.currentTime;
            // Tono 1: La5 (880Hz)
            playTone(880, now, 0.1, 0.3);
            // Tono 2: Do6 (1046.5Hz) con delay de 150ms para el efecto "doble"
            playTone(1046.5, now + 0.15, 0.12, 0.4);
        } catch { }
    }

    setSyncState(syncing: boolean, message: string = '', progress: number = 0, count: number = 0) {
        this._isSyncing.next(syncing);
        this.syncStatus.next(syncing ? 'syncing' : 'completed');
        this._syncMessage.next(message);
        this._syncProgress.next(progress);
        this._syncCount.next(count);
    }

    // --- Mailbox ---
    async getMailboxMessages(userLogin: string): Promise<MailboxMessage[]> {
        return invoke('get_mailbox_messages', { userLogin });
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
            direction: message.direction || 'outbox',
            userLogin: message.user_login
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
    async getAuthorizationTickets(userLogin: string): Promise<AuthorizationTicket[]> {
        return invoke('get_authorization_tickets', { userLogin });
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
        this.startAmbientSyncSound();

        // 1. Cargar mensajes locales para de-duplicación
        try {
            const existing = await this.getMailboxMessages(authorProfile.usuario);
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
                this.stopAmbientSyncSound();
                this.setSyncState(false);
            },
            complete: () => {
                this.flushAcks();
                if (this._isSyncing.value) {
                    this._syncProgress.next(100);
                    this._syncMessage.next('Sincronizado');
                    this.stopAmbientSyncSound();
                    this.playSyncCompleteSound();
                    setTimeout(() => this.setSyncState(false), 1200);
                }
            }
        });
    }

    // -- Private Helper Methods --

    private getAudioContext(): any {
        const w = window as any;
        if (!w._sharedAudioCtx) {
            const AudioContext = window.AudioContext || w.webkitAudioContext;
            if (AudioContext) w._sharedAudioCtx = new AudioContext();
        }
        const ctx = w._sharedAudioCtx;
        if (ctx && ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    private syncAmbientOscillator: any = null;
    private syncAmbientGain: any = null;

    private startAmbientSyncSound() {
        try {
            const ctx = this.getAudioContext();
            if (!ctx) return;
            
            if (this.syncAmbientOscillator) this.stopAmbientSyncSound();
            
            const osc = ctx.createOscillator();
            const osc2 = ctx.createOscillator();
            const gain = ctx.createGain();
            
            // Frecuencias para crear un 'drone' atmosférico elegante (espacial/tech)
            osc.type = 'sine';
            osc.frequency.setValueAtTime(65.41, ctx.currentTime); // C2

            osc2.type = 'triangle';
            osc2.frequency.setValueAtTime(130.81, ctx.currentTime); // C3
            
            osc.connect(gain);
            osc2.connect(gain);
            gain.connect(ctx.destination);
            
            // Fade-in extremadamente suave y volumen bajísimo
            gain.gain.setValueAtTime(0, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.015, ctx.currentTime + 1.5);
            
            osc.start();
            osc2.start();
            
            this.syncAmbientOscillator = [osc, osc2];
            this.syncAmbientGain = gain;
        } catch { }
    }

    private stopAmbientSyncSound() {
        try {
            if (!this.syncAmbientGain || !this.syncAmbientOscillator) return;
            const ctx = this.getAudioContext();
            
            // Elegante fade out
            this.syncAmbientGain.gain.linearRampToValueAtTime(0, ctx?.currentTime + 0.8);
            
            const [o1, o2] = this.syncAmbientOscillator;
            
            setTimeout(() => {
                try { o1.stop(); o2.stop(); } catch{}
            }, 1000);

            this.syncAmbientOscillator = null;
            this.syncAmbientGain = null;
        } catch { }
    }

    private playSyncCompleteSound() {
        try {
            const ctx = this.getAudioContext();
            if (!ctx) return;
            const playTone = (freq: number, startTime: number, vol: number) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.setValueAtTime(freq, startTime);
                gain.gain.setValueAtTime(0, startTime);
                gain.gain.linearRampToValueAtTime(vol, startTime + 0.05);
                gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.8);
                osc.start(startTime);
                osc.stop(startTime + 0.8);
            };
            const now = ctx.currentTime;
            // Arpegio cuásar ascendente de cristal (muy corporativo)
            playTone(523.25, now, 0.04);        // C5
            playTone(659.25, now + 0.1, 0.03);  // E5
            playTone(783.99, now + 0.2, 0.04);  // G5
            playTone(1046.50, now + 0.35, 0.06);// C6 (resonante final)
        } catch { }
    }

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
            direction: 'inbox',
            user_login: this.activeSyncConnection?.jwt_payload?.usuario || this.activeSyncConnection?.user || 'default'
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

    /**
     * Obtiene el identificador del usuario activo desde el JWT almacenado.
     * Útil para segregación de datos en componentes que no tienen acceso directo al payload.
     */
    getCurrentUserLogin(): string {
        try {
            // Intentar recuperar de la conexión activa en localStorage
            const activeConn = localStorage.getItem('active_connection');
            if (activeConn) {
                const conn = JSON.parse(activeConn);
                if (conn.jwt) {
                    const payload = JSON.parse(atob(conn.jwt.split('.')[1]));
                    return payload.Usuario?.usuario || payload.usuario || 'default';
                }
            }

            // Fallback: Buscar cualquier JWT en el almacenamiento
            const jwt = localStorage.getItem('jwt') || sessionStorage.getItem('jwt');
            if (jwt) {
                const payload = JSON.parse(atob(jwt.split('.')[1]));
                return payload.Usuario?.usuario || payload.usuario || 'default';
            }
        } catch (e) {
            console.warn("Error extrayendo usuario del JWT:", e);
        }
        return 'default';
    }
}
