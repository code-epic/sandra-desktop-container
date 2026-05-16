import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { listen } from '@tauri-apps/api/event';
import { DataStreamService } from './data-stream.service';
import { UtilsService } from './utils.service';

export interface MailboxMessage {
    id: number;
    sid: string;
    content: string;
    author: string;
    status: 'Pending' | 'Read' | 'Approved' | 'Rejected' | 'Completed' | 'EN PROCESO' | 'PENDIENTE' | 'CANCELADO' | string;
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

export interface IWorkflowStatus {
    id_referencia_doc: string;
    tipo: 'Soporte' | 'Seguimiento' | 'Autorización';
    estado: 'ABIERTO' | 'PENDIENTE' | 'APROBADO' | 'RECHAZADO' | 'CERRADO' | 'COMPLETADO';
    requiere_accion: boolean;
}

export interface IHiloRespuesta {
    id_mensaje: string;
    remitente: string;
    cuerpo: string;
    timestamp: Date | string;
    tipo_respuesta: 'comentario' | 'aprobacion' | 'rechazo';
}

export interface ICorreoWorkflow {
    workflow?: IWorkflowStatus;
    hilos?: IHiloRespuesta[];
    es_cadena?: boolean;
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

    private _mailboxRefreshTrigger = new Subject<string | undefined>();
    public mailboxRefreshTrigger$ = this._mailboxRefreshTrigger.asObservable();

    private _revisionCount = new BehaviorSubject<number>(0);
    public revisionCount$ = this._revisionCount.asObservable();

    private lastProgressUpdate = 0;
    private readonly UI_THROTTLE_MS = 150;
    public activeSyncConnection: any = null;
    public activeSyncAuthor: any = null;
    private existingGuids = new Set<string>();

    constructor(private dataStreamService: DataStreamService, private utils: UtilsService) {
        // Recuperar sesión persistida si existe (survive refresh)
        try {
            const storedConn = localStorage.getItem('active_connection');
            const storedAuthor = localStorage.getItem('author_profile');
            if (storedConn) this.activeSyncConnection = JSON.parse(storedConn);
            if (storedAuthor) this.activeSyncAuthor = JSON.parse(storedAuthor);
        } catch (e) {
            console.warn("[SecurityService] Error recuperando sesión persistida:", e);
        }

        // Escucha global de refresco desde Rust (Remote Control o Sync Interno)
        listen('refresh-mailbox', async (event: any) => {
            console.log("[Service] Señal de refresco recibida de Rust:", event.payload);

            // Despachar sonido doble de notificación (Refuerzo auditivo)
            this.playDoubleNotificationSound();

            this._mailboxRefreshTrigger.next(event.payload);
        });
    }

    private getAudioContext(): AudioContext | null {
        const w = window as any;
        if (!w._sharedAudioCtx) {
            const AudioContext = window.AudioContext || w.webkitAudioContext;
            if (AudioContext) w._sharedAudioCtx = new AudioContext();
        }
        const ctx = w._sharedAudioCtx as AudioContext | undefined;
        if (!ctx) return null;
        // Resume synchronously - browsers allow this during user gesture
        if (ctx.state === 'suspended') {
            ctx.resume().catch(() => { });
        }
        return ctx;
    }

    playDeleteSound() {
        const ctx = this.getAudioContext();
        if (!ctx) return;

        // Ensure context is running (synchronous resume during user gesture)
        if (ctx.state === 'suspended') {
            ctx.resume().catch(() => { });
        }

        const now = ctx.currentTime;

        // Tono principal descendente suave (swoosh elegante)
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.18);
        osc.connect(oscGain);
        oscGain.connect(ctx.destination);
        oscGain.gain.setValueAtTime(0, now);
        oscGain.gain.linearRampToValueAtTime(0.08, now + 0.02);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);

        // Armónico superior para brillo sutil
        const osc2 = ctx.createOscillator();
        const osc2Gain = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1200, now);
        osc2.frequency.exponentialRampToValueAtTime(400, now + 0.15);
        osc2.connect(osc2Gain);
        osc2Gain.connect(ctx.destination);
        osc2Gain.gain.setValueAtTime(0, now);
        osc2Gain.gain.linearRampToValueAtTime(0.03, now + 0.015);
        osc2Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc2.start(now);
        osc2.stop(now + 0.15);

        // Ruido suave filtrado para textura de aire
        const bufferSize = ctx.sampleRate * 0.15;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        const noiseFilter = ctx.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.setValueAtTime(2000, now);
        noiseFilter.Q.value = 0.7;
        const noiseGain = ctx.createGain();
        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(ctx.destination);
        noiseGain.gain.setValueAtTime(0, now);
        noiseGain.gain.linearRampToValueAtTime(0.02, now + 0.01);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        noise.start(now);
        noise.stop(now + 0.15);

        // Click final sutil de confirmación
        const click = ctx.createOscillator();
        const clickGain = ctx.createGain();
        click.type = 'sine';
        click.frequency.setValueAtTime(600, now + 0.12);
        click.connect(clickGain);
        clickGain.connect(ctx.destination);
        clickGain.gain.setValueAtTime(0, now + 0.12);
        clickGain.gain.linearRampToValueAtTime(0.04, now + 0.125);
        clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        click.start(now + 0.12);
        click.stop(now + 0.18);
    }

    private playDoubleNotificationSound() {
        const ctx = this.getAudioContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') {
            ctx.resume().catch(() => { });
        }

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
        playTone(880, now, 0.1, 0.3);
        playTone(1046.5, now + 0.15, 0.12, 0.4);
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
        return invoke('get_mailbox_messages', { userLogin: userLogin.toLowerCase() });
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
            userLogin: message.user_login || 'persona',
            status: message.status || 'Pending'
        });
    }

    async updateMailboxStatus(id: number, status: string, trackingInfo?: string) {
        return invoke('update_mailbox_status', { id, status, trackingInfo });
    }

    async updateMailboxFull(id: number, status: string, content: string, trackingInfo?: string) {
        return invoke('update_mailbox_full', { id, status, content, trackingInfo });
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
        return invoke('get_authorization_tickets', { userLogin: userLogin.toLowerCase() });
    }

    async deleteAuthorizationTicket(authId: string) {
        return invoke('delete_authorization_ticket', { authId });
    }

    async updateAuthorizationTicketStatus(authId: string, status: string) {
        return invoke('update_authorization_ticket_status', { authId, status });
    }

    // --- Sync Methods (Industrial-Scale Streaming) ---

    async startMailboxSync(activeConnection: any, authorProfile: any, clientId?: string) {
        if (this._isSyncing.value || !activeConnection || !authorProfile?.usuario) return;

        // Persistir sesión para que sobreviva a recargas (F5)
        localStorage.setItem('active_connection', JSON.stringify(activeConnection));
        localStorage.setItem('author_profile', JSON.stringify(authorProfile));

        this.activeSyncConnection = activeConnection;
        this.activeSyncAuthor = authorProfile;

        // Limpiar contador previo y activar visual inmediatamente
        this._syncCount.next(0);
        this.setSyncState(true, 'Iniciando sincronización...', 5, 0);
        this.startAmbientSyncSound();

        // 1. Cargar mensajes locales para de-duplicación
        try {
            const existing = await this.getMailboxMessages(authorProfile.usuario);
            this.existingGuids = new Set(existing.map(m => this.getMessageGuid(m.content)?.toLowerCase()).filter((g): g is string => !!g));
            // También añadir los sid por si acaso
            existing.forEach(m => { if (m.sid) this.existingGuids.add(m.sid.toLowerCase()); });
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
            complete: async () => {
                this.flushAcks();
                if (this._isSyncing.value) {
                    this._syncMessage.next('Verificando hilos...');

                    // Invocación proactiva y esperada del rastreo de hilos (REVISION)
                    const resolvedClientId = clientId || (authorProfile.usuario || 'persona').toLowerCase();
                    await this.syncWorkflowThreads(activeConnection, resolvedClientId);

                    this._syncProgress.next(100);
                    this._syncMessage.next('Sincronizado');
                    this.stopAmbientSyncSound();
                    this.playSyncCompleteSound();

                    setTimeout(() => this.setSyncState(false), 1200);
                }
            }
        });
    }

    async startManualsSync(activeConnection: any, authorProfile: any) {
        console.log("[SecurityService] startManualsSync() invocado", { connectionHash: activeConnection?.hash, user: authorProfile?.usuario });

        if (this._isSyncing.value || !activeConnection || !authorProfile?.usuario) {
            console.warn("[SecurityService] Sincronización de manuales rechazada: ya está sincronizando o faltan datos", {
                isSyncing: this._isSyncing.value,
                connection: !!activeConnection,
                user: !!authorProfile?.usuario
            });
            return;
        }

        this.setSyncState(true, 'Sincronizando Manuales...', 10, 0);
        this.startAmbientSyncSound();

        const login = (authorProfile.usuario || 'persona').toLowerCase();
        const endpoint = `v1/api/crudstream:${activeConnection.hash}`;
        const payload = { "funcion": 'SDC_CManuals', "parametros": "" };

        console.log(`[SecurityService] Iniciando Stream para endpoint: ${endpoint} con payload:`, payload);

        let count = 0;
        this.dataStreamService.streamPostRequest<any>(
            activeConnection.ip_address,
            Number(activeConnection.port),
            endpoint,
            payload,
            activeConnection.hash,
            activeConnection.jwt
        ).subscribe({
            next: async (item) => {
                console.log("[SecurityService] Raw manual item received from stream:", item);

                // Estructura detectada: Usar campos directos del objeto (nombre, categoria, etc.)
                const fileName = item.nombre || 'Documento sin nombre';
                const uuid = item._id || item.id || Math.random().toString(36).substring(7);
                const category = item.categoria || 'Sin Categoría';
                const fileSize = item.tamanio_human || (item.tamanio_bytes ? `${(item.tamanio_bytes / 1024).toFixed(1)} KB` : 'Vault');
                const filePath = item.ruta_relativa || item.ruta_completa || '';
                const sha256 = item.hash?.sha256 || '';

                console.log(`[SecurityService] Item procesado: ${fileName} -> Categoría: ${category}`);

                console.log(`[SecurityService] Guardando manual ${fileName} en historial...`);

                await invoke('add_document_history', {
                    fileName,
                    filePath,
                    fileSize,
                    remoteCode: uuid,
                    source: 'MANUALS',
                    fileHash: sha256,
                    groupName: category,
                    userLogin: login,
                    metadata: JSON.stringify(item)
                });

                console.log(`[SecurityService] Manual ${fileName} guardado.`);
                // invoke('refresh_document_history_signal'); // Movido al final para mayor eficiencia

                count++;
                this._syncCount.next(count);
                this._syncMessage.next(`Manual: ${fileName}`);
                this._syncProgress.next(Math.min(count * 5, 95));
            },
            error: (err) => {
                console.error("[SecurityService] Error fatal en streaming de manuales:", err);
                this.stopAmbientSyncSound();
                this.setSyncState(false);
            },
            complete: () => {
                console.log(`[SecurityService] Sincronización de manuales terminada. Total: ${count}`);
                this._syncProgress.next(100);
                this._syncMessage.next('Manuales Sincronizados');
                this.stopAmbientSyncSound();
                this.playSyncCompleteSound();

                // Trigger refresh for secure viewer
                console.log("[SecurityService] Emitiendo señal de refresco...");
                invoke('refresh_document_history_signal');

                setTimeout(() => this.setSyncState(false), 1200);
            }
        });
    }

    // -- Private Helper Methods --

    private syncAmbientOscillator: any = null;
    private syncAmbientGain: any = null;

    private startAmbientSyncSound() {
        try {
            const ctx = this.getAudioContext();
            if (!ctx) return;

            if (ctx.state === 'suspended') {
                ctx.resume().catch(() => { });
            }

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
            if (!ctx) return;

            // Elegante fade out
            this.syncAmbientGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);

            const [o1, o2] = this.syncAmbientOscillator;

            setTimeout(() => {
                try { o1.stop(); o2.stop(); } catch { }
            }, 1000);

            this.syncAmbientOscillator = null;
            this.syncAmbientGain = null;
        } catch { }
    }

    private playSyncCompleteSound() {
        try {
            const ctx = this.getAudioContext();
            if (!ctx) return;
            if (ctx.state === 'suspended') {
                ctx.resume().catch(() => { });
            }
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

        // Determinar el login del usuario para la segregación de datos. 
        // Priorizamos el perfil activo que inició la sincronización.
        const userLogin = this.activeSyncAuthor?.usuario || 'default';

        // Determinar el autor para calcular la dirección del correo
        const authorStr = item.message_envelope?.from || item.message_envelope?.author || item.manifest?.sender || item.author || 'Unknown';

        // Determinar si el correo fue enviado por el usuario activo
        const isSentByMe = authorStr.toLowerCase().includes(userLogin.toLowerCase());
        const calculatedDirection = isSentByMe ? 'outbox' : 'inbox';

        // Extraer el estado del payload si está presente (puede estar en la raíz o dentro de workflow)
        const calculatedStatus = item.workflow?.estado || item.estado || item.status || 'Pending';

        await this.createMailboxMessage({
            sid: String(guid),
            content: JSON.stringify(item),
            author: authorStr,
            responsible: item.message_envelope?.to || item.responsible || 'persona.consola',
            direction: calculatedDirection,
            user_login: userLogin,
            status: calculatedStatus
        });

        console.log(`[Sync] Documento insertado en BD Local. ID: ${guid} | Bandeja: ${calculatedDirection} | Estado: ${calculatedStatus}`);
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
            const jwt = activeConn ? JSON.parse(activeConn).jwt : (localStorage.getItem('jwt') || sessionStorage.getItem('jwt'));

            if (jwt) {
                const payload = this.utils.decodeJwt(jwt);
                if (payload) {
                    const login = payload.Usuario?.usuario || payload.usuario || payload.Login || 'default';
                    return login.toLowerCase();
                }
            }
        } catch (e) {
            console.warn("Error extrayendo usuario del JWT:", e);
        }
        return 'default';
    }

    /**
     * Decodifica el payload de un JWT (Base64URL) de forma segura.
     * @deprecated Use UtilsService.decodeJwt instead
     */
    private safeDecodeJWT(token: string): any {
        return this.utils.decodeJwt(token);
    }

    /**
     * Sincronización proactiva de hilos de workflow (Modo REVISION)
     * Utiliza el patrón de crudstream para procesamiento en tiempo real.
     */
    /**
     * Sincronización proactiva de hilos de workflow (Modo REVISION)
     * Utiliza el patrón de crudstream para procesamiento en tiempo real.
     */
    syncWorkflowThreads(activeConnection: any, clientId: string): Promise<number> {
        return new Promise((resolve) => {
            if (!activeConnection?.hash) return resolve(0);

            const endpoint = `v1/api/crudstream:${activeConnection.hash}`;
            const payload = {
                "funcion": 'SDC_CMailThread',
                "parametros": `REVISION,${clientId}`
            };

            console.log(`[Service] Iniciando Streaming de Hilos (REVISION) para: ${clientId}`);
            const currentRevisionItems: any[] = [];
            const updatePromises: Promise<any>[] = [];

            this.dataStreamService.streamPostRequest<any>(
                activeConnection.ip_address,
                Number(activeConnection.port),
                endpoint,
                payload,
                activeConnection.hash,
                activeConnection.jwt
            ).subscribe({
                next: (remoteMsg) => {
                    console.log("[Service] Hilo recibido en stream:", remoteMsg);
                    currentRevisionItems.push(remoteMsg);

                    // Certificar descarga del hilo (ACK al server)
                    this.certifyDownload(remoteMsg);

                    const localId = remoteMsg.local_id || remoteMsg.id;
                    const remoteStatus = remoteMsg.workflow?.estado || remoteMsg.estado || remoteMsg.status || 'Pending';
                    const remoteContent = JSON.stringify(remoteMsg); // El objeto completo del servidor

                    if (localId) {
                        console.log(`[Service] Sincronización TOTAL para ID ${localId} -> ${remoteStatus}`);
                        const updatePromise = invoke('update_mailbox_full_by_sid', {
                            sid: localId,
                            status: remoteStatus,
                            content: remoteContent,
                            trackingInfo: `Workflow Full Sync: ${remoteStatus}`
                        });
                        updatePromises.push(updatePromise);
                    }
                    this._revisionCount.next(currentRevisionItems.length);
                },
                error: (err) => {
                    console.error("[Service] Error en streaming de hilos (REVISION):", err);
                    resolve(currentRevisionItems.length);
                },
                complete: async () => {
                    console.log(`[Service] Streaming de hilos completado. Total: ${currentRevisionItems.length}. Esperando escrituras locales...`);

                    // Esperar a que TODAS las actualizaciones en SQLite terminen
                    await Promise.all(updatePromises);

                    console.log(`[Service] Escrituras locales de hilos finalizadas.`);
                    this._revisionCount.next(currentRevisionItems.length);

                    // Certificar el lote final de hilos recibidos
                    this.flushAcks();

                    // Notificar al componente que debe refrescar la vista local AHORA QUE LA BD ESTÁ LISTA
                    this._mailboxRefreshTrigger.next('workflow-sync-complete');

                    resolve(currentRevisionItems.length);
                }
            });
        });
    }
}
