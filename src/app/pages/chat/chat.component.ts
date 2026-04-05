import {
  Component,
  Input,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  AfterViewChecked,
  OnChanges,
  SimpleChanges
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { WebSocketService } from "../../core/services/websocket.service";
import { SdcService } from "../../core/services/sdc.service";
import { Subscription } from "rxjs";
import { invoke } from "@tauri-apps/api/core";

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface ChatMessage {
  text: string;
  sender: "user" | "sandra";
  from?: string;
  timestamp: Date;
  isTyping?: boolean;
  status?: "sent" | "pending" | "sending" | "error";
}

interface Conversation {
  id: string;
  name: string;
  initial: string;
  isSandra: boolean;
  messages: ChatMessage[];
  unread: number;
  lastMessage?: string;
  lastTime?: Date;
  isOnline: boolean;
  login?: string;
}

interface Contact {
  // Identificación
  login?: string;
  user_name?: string;
  name?: string;
  nombre?: string;
  // Contacto
  email?: string;
  correo?: string;
  // Cargo y perfil
  cargo?: string;
  perfil_grupo?: string;
  area?: string;
  role?: string;
  Perfil?: { descripcion?: string };
  // Aplicación
  aplicacion?: string;
  sistema?: string;
  // Descripción libre
  descripcion?: string;
  // Técnico
  uuid?: string;
  // Runtime
  isOnline?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

@Component({
  selector: "app-chat",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./chat.component.html",
  styleUrls: ["./chat.component.css"],
})
export class ChatComponent implements OnInit, OnChanges, OnDestroy, AfterViewChecked {
  private chatSub?: Subscription;

  @Input() wsStatus: string = "Desconectado";
  @Input() activeConnection: any;
  @Input() config: any;
  @Input() clientId: string = "";
  @Input() visible: boolean = true;
  @Input() hasJwt: boolean = false;
  @Input() userProfile: any; // Perfil del usuario activo (usuario, sistema)

  @ViewChild("scrollContainer") scrollContainer!: ElementRef;

  // ── FAB / window state
  isOpen = false;
  isLoading = true;
  newMessage = "";
  isTyping = false;

  // ── Vista: "conversations" | "chat" | "contacts" | "history"
  view: "conversations" | "chat" | "contacts" | "history" = "conversations";

  // ── Conversaciones
  conversations: Conversation[] = [];
  activeConv: Conversation | null = null;

  // ── Contactos agenda (patrón security.component)
  contacts: Contact[] = [];
  isContactsSyncing = false;
  contactAppFilter = "";
  contactSearch = "";
  selectedContact: Contact | null = null;   // Perfil expandido

  // ── Usuarios activos (online) para marcar contactos
  activeUsers: any[] = [];

  // ── Historial Sandra IA
  historyGroups: any[] = [];

  // ── Modal confirmación
  confirmModal = {
    show: false,
    title: "",
    message: "",
    type: "single" as "single" | "all" | "conversation",
    session: null as any,
  };

  private jwtCheckInterval: any;

  private get userSuffix(): string {
    return this.userProfile?.usuario || 'guest';
  }

  // ── Storage key ligado a la conexión activa y AL USUARIO
  private get contactStorageKey(): string {
    return `sdc_contacts_${this.activeConnection?.id || "default"}_${this.userSuffix}`;
  }

  constructor(
    private wsService: WebSocketService,
    private sdcService: SdcService
  ) { }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  ngOnInit() {
    this.ensureSandraConversation();
    this.loadAllConversations();
    this.loadHistoryGroups();
    this.loadContactsLocal();

    this.chatSub = this.wsService.chatMessages$.subscribe((msg) => {
      this.routeIncomingMessage(msg.from, msg.message);
    });

    setTimeout(() => {
      this.isLoading = false;
      const sandra = this.getSandraConv();
      if (sandra && sandra.messages.length === 0) {
        this.addSystemMessage(sandra, "Hola, soy Sandra. ¿En qué puedo ayudarte?");
      }
    }, 800);

    this.jwtCheckInterval = setInterval(() => {
      this.checkAndSendPendingMessages();
      // Si el JWT expiró y estamos en una vista protegida → regresar a conversaciones
      const protectedViews: Array<typeof this.view> = ['contacts', 'history'];
      if (protectedViews.includes(this.view) && !this.isLoggedIn()) {
        this.view = 'conversations';
        this.selectedContact = null;
      }
    }, 5000);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['userProfile'] && !changes['userProfile'].firstChange) {
      this.loadAllConversations();
      this.loadHistoryGroups();
      this.loadContactsLocal();
    }
  }

  ngOnDestroy() {
    this.chatSub?.unsubscribe();
    if (this.jwtCheckInterval) clearInterval(this.jwtCheckInterval);
  }

  ngAfterViewChecked() {
    if (!this.activeConv?.messages.some((m) => m.isTyping)) {
      this.scrollToBottom();
    }
  }

  // ─── Computed ──────────────────────────────────────────────────────────────

  get totalUnread(): number {
    return this.conversations.reduce((s, c) => s + c.unread, 0);
  }

  /** Sin JWT: solo muestra la conversación de Sandra IA */
  get visibleConversations(): Conversation[] {
    return this.isLoggedIn() ? this.conversations : this.conversations.filter(c => c.isSandra);
  }

  get filteredContacts(): Contact[] {
    const validContacts = this.contacts.filter(c => {
      const login = this.getContactLogin(c).toLowerCase();
      return login !== 'xterm' &&
        login !== (this.clientId || '').toLowerCase() &&
        (c.uuid || '').toLowerCase() !== (this.clientId || '').toLowerCase();
    });
    if (!this.contactSearch.trim()) return validContacts;
    const q = this.contactSearch.toLowerCase();
    return validContacts.filter((c) =>
      (c.name || c.nombre || c.user_name || c.login || "").toLowerCase().includes(q) ||
      (c.login || "").toLowerCase().includes(q) ||
      (c.area || "").toLowerCase().includes(q)
    );
  }

  get contactsOnlineCount(): number {
    return this.contacts.filter((c) => {
      const login = this.getContactLogin(c).toLowerCase();
      return this.isContactOnline(c) &&
        login !== 'xterm' &&
        login !== (this.clientId || '').toLowerCase() &&
        (c.uuid || '').toLowerCase() !== (this.clientId || '').toLowerCase();
    }).length;
  }

  /** Color de avatar basado en nombre (paleta SDC matte) */
  getColorForName(name: string): string {
    if (!name) return '#a3aca5';
    // Paleta SDC: Grises y verdes formales, mates y delicados
    const colors = [
      '#8fa396', '#98a8a0', '#a3aca5', '#889e93', '#9eb0a8',
      '#a0acab', '#91a198', '#8b9b92', '#b2bbb6', '#8d9c94'
    ];
    const idx = name.charCodeAt(0) % colors.length;
    return colors[idx];
  }

  getContactColor(c: Contact): string {
    return this.getColorForName(this.getContactName(c));
  }

  showContactProfile(contact: Contact, event: Event) {
    event.stopPropagation();
    this.selectedContact = contact;
  }

  closeContactProfile() {
    this.selectedContact = null;
  }

  getContactName(c: Contact): string {
    return c.nombre || c.name || c.user_name || c.login || 'Sin nombre';
  }

  getContactLogin(c: Contact): string {
    return c.login || c.user_name || '';
  }

  getContactInitial(c: Contact): string {
    return this.getContactName(c).charAt(0).toUpperCase();
  }

  getContactEmail(c: Contact): string {
    return c.correo || c.email || '';
  }

  getContactCargo(c: Contact): string {
    return c.cargo || c.role || '';
  }

  getContactPerfil(c: Contact): string {
    return c.Perfil?.descripcion || c.perfil_grupo || c.area || '';
  }

  getContactApp(c: Contact): string {
    return c.aplicacion || c.sistema || '';
  }

  getContactDesc(c: Contact): string {
    return c.descripcion || '';
  }

  isContactOnline(c: Contact): boolean {
    const login = this.getContactLogin(c).toLowerCase();
    if (!login && !c.uuid) return false;
    return this.activeUsers.some(
      (u) => {
        if (login && (u.name || "").toLowerCase() === login) return true;
        if (c.uuid && (u.uuid || "") === c.uuid) return true;
        return false;
      }
    );
  }

  // ─── Sandra conversation ───────────────────────────────────────────────────

  private ensureSandraConversation() {
    if (!this.conversations.find((c) => c.id === "sandra")) {
      this.conversations.unshift({
        id: "sandra",
        name: "Sandra IA",
        initial: "S",
        isSandra: true,
        messages: [],
        unread: 0,
        isOnline: true,
      });
    }
  }

  getSandraConv(): Conversation | undefined {
    return this.conversations.find((c) => c.id === "sandra");
  }

  // ─── Contacts Agenda (patrón security.component) ───────────────────────────

  loadContactsLocal() {
    try {
      const stored = localStorage.getItem(this.contactStorageKey);
      if (stored) this.contacts = JSON.parse(stored);
      else this.contacts = [];
    } catch { this.contacts = []; }
  }

  saveContactsLocal() {
    localStorage.setItem(this.contactStorageKey, JSON.stringify(this.contacts));
  }

  async syncContacts() {
    if (this.isContactsSyncing) return;
    this.isContactsSyncing = true;

    // Limpia la agenda antigua forzosamente
    this.contacts = [];
    this.activeUsers = [];
    localStorage.removeItem(this.contactStorageKey);

    if (!this.activeConnection?.hash) {
      this.isContactsSyncing = false;
      return;
    }

    try {
      if (this.isLoggedIn()) {
        await this.loadActiveUsers();
      } else {
        this.activeUsers = [];
      }
    } catch (e) {
      console.warn("Contacts sync error:", e);
    } finally {
      this.isContactsSyncing = false;
    }
  }

  async loadActiveUsers() {
    if (!this.activeConnection || !this.config) return;
    if (!this.isLoggedIn()) { this.activeUsers = []; return; }
    try {
      const storage = this.config.access.jwtStorage === "sessionStorage" ? sessionStorage : localStorage;
      const token = storage.getItem(this.config.access.jwtVariableName);
      const response = await this.sdcService.apiGetRequest(
        this.activeConnection.ip_address,
        this.activeConnection.port,
        "v1/api/sandra_sessions",
        this.activeConnection.hash,
        token
      );

      let activeList: any[] = [];
      if (response && response.type === "clients_list" && Array.isArray(response.message)) {
        activeList = response.message.filter((c: any) => c.status === "online");
      } else if (response && Array.isArray(response)) {
        activeList = response;
      }

      if (response) {
        this.activeUsers = activeList.map((u: any) => ({
          name: u.name || u.Username || u.User || "Terminal",
          uuid: u.id || u.uuid || u.ID || u.Uuid || "",
          initial: (u.name || u.Username || "T").charAt(0).toUpperCase(),
        }));

        this.contacts = activeList.map((c: any) => ({
          login: c.name || c.Username,
          name: c.name || c.Username,
          uuid: c.id || c.uuid || c.ID,
          descripcion: c.id || c.uuid || c.ID,
          cargo: c.mac_address || "",
          isOnline: true
        }));
        this.saveContactsLocal();

        this.conversations.forEach((c) => {
          c.isOnline = c.isSandra || this.activeUsers.some((u) => u.uuid === c.id || (u.name || "").toLowerCase() === (c.login || "").toLowerCase());
        });
      }
    } catch { }
  }

  // ─── Persistence ──────────────────────────────────────────────────────────

  private storageKey(id: string) {
    return `sdc_chat_${this.activeConnection?.id || "default"}_${this.userSuffix}_${id}`;
  }

  private saveConversation(conv: Conversation) {
    localStorage.setItem(this.storageKey(conv.id), JSON.stringify(conv.messages));
    this.updatePreview(conv);
  }

  private loadAllConversations() {
    const sandraConv = this.getSandraConv();
    if (sandraConv) {
      const raw = localStorage.getItem(this.storageKey("sandra"));
      if (raw) {
        try {
          sandraConv.messages = JSON.parse(raw).map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }));
          this.updatePreview(sandraConv);
        } catch { }
      }
    }
    const convListKey = `sdc_chat_convs_${this.activeConnection?.id || "default"}_${this.userSuffix}`;
    const raw = localStorage.getItem(convListKey);
    if (raw) {
      try {
        const savedConvs: Array<{ id: string; name: string; initial: string; login?: string }> = JSON.parse(raw);
        for (const sc of savedConvs) {
          if (sc.id === "sandra") continue;
          let conv = this.conversations.find((c) => c.id === sc.id);
          if (!conv) {
            conv = { id: sc.id, name: sc.name, initial: sc.initial, login: sc.login, isSandra: false, messages: [], unread: 0, isOnline: false };
            this.conversations.push(conv);
          }
          const msgRaw = localStorage.getItem(this.storageKey(sc.id));
          if (msgRaw) {
            try {
              conv.messages = JSON.parse(msgRaw).map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }));
              this.updatePreview(conv);
            } catch { }
          }
        }
      } catch { }
    }
  }

  private saveConvList() {
    const key = `sdc_chat_convs_${this.activeConnection?.id || "default"}_${this.userSuffix}`;
    localStorage.setItem(key, JSON.stringify(this.conversations.map((c) => ({ id: c.id, name: c.name, initial: c.initial, login: c.login }))));
  }

  private updatePreview(conv: Conversation) {
    const last = conv.messages.filter((m) => !m.isTyping).at(-1);
    conv.lastMessage = last?.text.slice(0, 45) || "";
    conv.lastTime = last?.timestamp;
  }

  // ─── Navigation ────────────────────────────────────────────────────────────

  /**
   * Fuente única de verdad: usa el @Input hasJwt provisto por app.component.
   * No lee localStorage directamente para evitar tokens expirados/obsoletos.
   */
  isLoggedIn(): boolean {
    if (this.wsStatus === 'Desconectado') return false;
    return this.hasJwt;
  }

  toggleChat() {
    // No abrir si está desconectado o sin sesión
    if (!this.isOpen && !this.isLoggedIn()) return;
    this.isOpen = !this.isOpen;
    if (this.isOpen) setTimeout(() => this.scrollToBottom(), 150);
  }

  openConversation(conv: Conversation) {
    this.activeConv = conv;
    conv.unread = 0;
    this.view = "chat";
    setTimeout(() => this.scrollToBottom(), 100);
  }

  backToList() {
    this.activeConv = null;
    this.view = "conversations";
  }

  openContacts() {
    if (!this.isLoggedIn()) return;   // Guard JWT
    this.view = 'contacts';
    this.syncContacts();
  }

  openHistory() {
    if (!this.isLoggedIn()) return;   // Guard JWT
    this.view = 'history';
    this.loadHistoryGroups();
  }

  closeSecondaryView() {
    this.view = this.activeConv ? 'chat' : 'conversations';
  }

  /** Elimina una conversación usando el modal global */
  deleteConversation(conv: Conversation, event: Event) {
    event.stopPropagation();
    if (conv.isSandra) return; // Proteger conv Sandra
    this.confirmModal = {
      show: true, title: "¿Eliminar Contacto?",
      message: `¿Seguro que deseas eliminar el historial local con ${conv.name}?`,
      type: "conversation", session: conv,
    };
  }

  // ─── Start conversation from contact ──────────────────────────────────────

  startConvWithContact(contact: Contact) {
    const id = contact.uuid || contact.login || contact.user_name || this.getContactName(contact);
    const name = this.getContactName(contact);
    const initial = this.getContactInitial(contact);
    const login = this.getContactLogin(contact);

    let conv = this.conversations.find((c) => c.id === id);
    if (!conv) {
      conv = { id, name, initial, login, isSandra: false, messages: [], unread: 0, isOnline: this.isContactOnline(contact) };
      this.conversations.push(conv);
      this.saveConvList();
    } else {
      if (!conv.login && login) {
        conv.login = login;
        this.saveConvList();
      }
    }
    this.openConversation(conv);
  }

  // ─── Messaging ─────────────────────────────────────────────────────────────

  async sendMessage(event?: Event) {
    if (event) event.preventDefault();
    if (!this.newMessage.trim() || !this.activeConv) return;

    const conv = this.activeConv;
    const userText = this.newMessage.trim();
    this.newMessage = "";
    this.resetTextareaHeight();

    const msg: ChatMessage = { text: userText, sender: "user", timestamp: new Date(), status: "sending" };
    conv.messages.push(msg);
    this.saveConversation(conv);
    this.playSendSound();

    if (conv.isSandra) {
      this.isTyping = true;
      await this.deliverToSandra(msg, conv);
      this.isTyping = false;
    } else {
      await this.deliverToUser(msg, conv);
    }
    this.scrollToBottom();
  }

  private async deliverToSandra(msg: ChatMessage, conv: Conversation) {
    if (!this.activeConnection || !this.config) { msg.status = "pending"; return; }
    msg.status = "sending";
    try {
      const storage = this.config.access.jwtStorage === "sessionStorage" ? sessionStorage : localStorage;
      const token = storage.getItem(this.config.access.jwtVariableName);
      if (!token) { msg.status = "pending"; return; }
      const response = await this.sdcService.apiPostRequest(
        this.activeConnection.ip_address, this.activeConnection.port,
        "v1/api/sandra_send-message",
        { Type: "chat", ID: "", Message: msg.text, From: this.clientId, To: "xterm", Timestamp: msg.timestamp.toISOString(), Status: "pending" },
        this.activeConnection.hash, token
      );
      if (response?.Message) this.typeWriterEffect(response.Message, "Sandra", conv);
      msg.status = "sent";
      this.saveConversation(conv);
    } catch { msg.status = "pending"; }
  }

  private async deliverToUser(msg: ChatMessage, conv: Conversation) {
    if (!this.activeConnection || !this.config) { msg.status = "pending"; return; }
    msg.status = "sending";
    try {
      const storage = this.config.access.jwtStorage === "sessionStorage" ? sessionStorage : localStorage;
      const token = storage.getItem(this.config.access.jwtVariableName);
      if (!token) { msg.status = "pending"; return; }

      const me = this.activeUsers.find(u => u.uuid === this.clientId);
      const fromName = me ? me.name : this.clientId;

      await this.sdcService.apiPostRequest(
        this.activeConnection.ip_address, this.activeConnection.port,
        "v1/api/sandra_send-message",
        { Type: "chat", To: conv.login, Message: msg.text, From: fromName },
        this.activeConnection.hash, token
      );
      msg.status = "sent";
      this.saveConversation(conv);
    } catch { msg.status = "pending"; }
  }

  private routeIncomingMessage(from: string, text: string) {
    // 0. Interceptar bots de sistema para forzarlos al canal de Sandra IA
    if (from === "xterm" || from === "sandra-core") {
      let conv = this.getSandraConv();
      if (conv) {
        if (!this.isOpen || this.activeConv?.id !== conv.id) conv.unread++;
        this.typeWriterEffect(text, from, conv);
        this.playNotificationSound();
      }
      return;
    }

    // 1. Tratar de ubicar la conversacion por id, name o login
    let conv = this.conversations.find((c) => 
       c.id === from || 
       c.name.toLowerCase() === from.toLowerCase() || 
       (c.login || "").toLowerCase() === from.toLowerCase()
    );

    // 2. Si no existe, buscar el contacto en la Agenda y auto-crearla
    if (!conv) {
      const contact = this.contacts.find(c => 
         c.uuid === from || 
         (c.login || "").toLowerCase() === from.toLowerCase() || 
         (c.name || "").toLowerCase() === from.toLowerCase()
      );
      
      if (contact) {
        this.startConvWithContact(contact);
        conv = this.conversations.find((c) => c.id === (contact.uuid || this.getContactLogin(contact)));
      } else if (from && from !== "sandra-core") {
        // 3. Crear conversacion fantasma si el contacto no existe en la agenda pero nos habla
        conv = {
          id: from,
          name: from,
          initial: from.charAt(0).toUpperCase(),
          login: from,
          isSandra: false,
          messages: [],
          unread: 0,
          isOnline: true
        };
        this.conversations.push(conv);
        this.saveConvList();
      }
    }

    // 4. Si TODO falla (ej. from='sandra-core' o fallo extremo), enviar a Sandra IA
    if (!conv) conv = this.getSandraConv();
    if (!conv) return;

    if (!this.isOpen || this.activeConv?.id !== conv.id) conv.unread++;
    this.typeWriterEffect(text, from, conv);
    this.playNotificationSound();
  }

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

  private playSendSound() {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.1);
    } catch { }
  }

  private playNotificationSound() {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      
      const playTone = (freq: number, startTime: number, duration: number, volume: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        // Onda 'sine' (senoidal) para suavidad tipo "cristal"
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startTime);
        
        gain.gain.setValueAtTime(0, startTime);
        // Ataque ultra rápido para darle "punch" inicial (UI moderno)
        gain.gain.linearRampToValueAtTime(volume, startTime + 0.015);
        // Decaimiento sutil para simular acústica
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        
        osc.start(startTime);
        osc.stop(startTime + duration);
      };

      const now = ctx.currentTime;
      // Doble tono moderno tipo iMessage / Telegram. Subimos el volumen a 0.3 y 0.4.
      playTone(659.25, now, 0.15, 0.3);         // Mi (E5)
      playTone(880.00, now + 0.12, 0.30, 0.4);  // La (A5)

    } catch(e) {}
  }

  private checkAndSendPendingMessages() {
    if (!this.activeConv) return;
    const pending = this.activeConv.messages.filter((m) => m.sender === "user" && m.status === "pending");
    if (pending.length > 0) {
      pending.forEach((msg) => {
        if (this.activeConv?.isSandra) this.deliverToSandra(msg, this.activeConv!);
        else if (this.activeConv) this.deliverToUser(msg, this.activeConv!);
      });
    }
  }

  // ─── Typewriter ────────────────────────────────────────────────────────────

  typeWriterEffect(text: string, from: string = "Sandra", conv?: Conversation) {
    if (!text) return;
    const target = conv ?? this.getSandraConv();
    if (!target) return;
    const msg: ChatMessage = { text: "", sender: "sandra", from, timestamp: new Date(), isTyping: true };
    target.messages.push(msg);
    this.saveConversation(target);
    let i = 0;
    setTimeout(() => {
      const type = () => {
        if (i < text.length) {
          msg.text += text.charAt(i++);
          if (i % 5 === 0) this.scrollToBottom();
          setTimeout(type, 22);
        } else {
          msg.isTyping = false;
          this.saveConversation(target);
          this.scrollToBottom();
        }
      };
      type();
    }, 30);
  }

  addSystemMessage(conv: Conversation, text: string) {
    conv.messages.push({ text, from: "Sistema", sender: "sandra", timestamp: new Date() });
    this.saveConversation(conv);
    this.scrollToBottom();
  }

  // ─── History ───────────────────────────────────────────────────────────────

  private get historyKey(): string {
    return `sandra_chat_history_${this.userSuffix}`;
  }

  loadHistoryGroups() {
    const raw = localStorage.getItem(this.historyKey);
    if (raw) {
      try {
        this.historyGroups = JSON.parse(raw).sort(
          (a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()
        );
      } catch { this.historyGroups = []; }
    }
  }

  startNewConversation() {
    const sandra = this.getSandraConv();
    if (!sandra || sandra.messages.length <= 1) return;
    const session = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      messages: [...sandra.messages],
      preview: sandra.messages.find((m) => m.sender === "user")?.text.slice(0, 60) || "Sin mensajes",
    };
    const history = JSON.parse(localStorage.getItem(this.historyKey) || "[]");
    history.push(session);
    localStorage.setItem(this.historyKey, JSON.stringify(history));
    sandra.messages = [];
    localStorage.removeItem(this.storageKey("sandra"));
    this.addSystemMessage(sandra, "Nueva sesión iniciada. ¿En qué puedo ayudarte?");
    this.loadHistoryGroups();
    this.view = "chat";
    this.activeConv = sandra;
  }

  viewArchivedSession(session: any) {
    const sandra = this.getSandraConv();
    if (!sandra) return;
    sandra.messages = session.messages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }));
    this.saveConversation(sandra);
    this.activeConv = sandra;
    this.view = "chat";
    setTimeout(() => this.scrollToBottom(), 150);
  }

  deleteSession(session: any, event: Event) {
    event.stopPropagation();
    this.confirmModal = {
      show: true, title: "¿Eliminar Conversación?",
      message: "Esta sesión se borrará permanentemente del historial.",
      type: "single", session,
    };
  }

  clearAllHistory() {
    this.confirmModal = {
      show: true, title: "¿Limpiar Historial?",
      message: "Se borrarán todas las conversaciones archivadas.",
      type: "all", session: null,
    };
  }

  handleConfirmDelete() {
    if (this.confirmModal.type === "conversation" && this.confirmModal.session) {
      const conv = this.confirmModal.session;
      this.conversations = this.conversations.filter((c) => c.id !== conv.id);
      localStorage.removeItem(this.storageKey(conv.id));
      this.saveConvList();
      if (this.activeConv?.id === conv.id) {
        this.activeConv = null;
        this.view = 'conversations';
      }
    } else if (this.confirmModal.type === "single" && this.confirmModal.session) {
      const idx = this.historyGroups.findIndex((g) => g.id === this.confirmModal.session.id);
      if (idx > -1) {
        this.historyGroups.splice(idx, 1);
        localStorage.setItem(this.historyKey, JSON.stringify(this.historyGroups));
      }
    } else if (this.confirmModal.type === "all") {
      localStorage.removeItem(this.historyKey);
      this.historyGroups = [];
    }
    this.closeConfirmModal();
  }

  closeConfirmModal() { this.confirmModal.show = false; this.confirmModal.session = null; }

  // ─── Utils ─────────────────────────────────────────────────────────────────

  isNewDay(messages: ChatMessage[], index: number): boolean {
    if (index === 0) return true;
    return new Date(messages[index].timestamp).toDateString() !== new Date(messages[index - 1].timestamp).toDateString();
  }

  scrollToBottom(): void {
    try {
      if (this.scrollContainer) {
        this.scrollContainer.nativeElement.scrollTo({ top: this.scrollContainer.nativeElement.scrollHeight, behavior: "auto" });
      }
    } catch { }
  }

  handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); this.sendMessage(); }
  }

  onInput(event: any) {
    const ta = event.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
  }

  private resetTextareaHeight() {
    setTimeout(() => {
      const ta = document.querySelector(".input-wrapper textarea") as HTMLTextAreaElement;
      if (ta) ta.style.height = "auto";
    }, 0);
  }
}
