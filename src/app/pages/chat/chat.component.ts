import {
  Component,
  Input,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  AfterViewChecked,
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
  status?: "sent" | "pending" | "error";
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
export class ChatComponent implements OnInit, OnDestroy, AfterViewChecked {
  private chatSub?: Subscription;

  @Input() wsStatus: string = "Desconectado";
  @Input() activeConnection: any;
  @Input() config: any;
  @Input() clientId: string = "";
  @Input() visible: boolean = true;
  @Input() hasJwt: boolean = false;   // Fuente única de verdad del JWT (desde app.component)

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
    type: "single" as "single" | "all",
    session: null as any,
  };

  private jwtCheckInterval: any;

  // ── Storage key ligado a la conexión activa
  private get contactStorageKey(): string {
    return `sdc_contacts_${this.activeConnection?.id || "default"}`;
  }

  constructor(
    private wsService: WebSocketService,
    private sdcService: SdcService
  ) {}

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
    if (!this.contactSearch.trim()) return this.contacts;
    const q = this.contactSearch.toLowerCase();
    return this.contacts.filter((c) =>
      (c.name || c.nombre || c.user_name || c.login || "").toLowerCase().includes(q) ||
      (c.login || "").toLowerCase().includes(q) ||
      (c.area || "").toLowerCase().includes(q)
    );
  }

  get contactsOnlineCount(): number {
    return this.contacts.filter((c) => this.isContactOnline(c)).length;
  }

  /** Color de avatar basado en la inicial (paleta SDC matte) */
  getContactColor(c: Contact): string {
    const colors = [
      '#7cac80','#64b5f6','#f06292','#ffb74d','#9575cd',
      '#4db6ac','#e57373','#aed581','#4dd0e1','#ff8a65'
    ];
    const name = this.getContactName(c);
    const idx = name.charCodeAt(0) % colors.length;
    return colors[idx];
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
    return this.activeUsers.some(
      (u) => (u.name || "").toLowerCase() === login || (u.uuid || "") === c.uuid
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
    this.loadContactsLocal();

    if (!this.activeConnection?.hash) {
      this.isContactsSyncing = false;
      return;
    }

    try {
      const endpoint = `v1/api/crud:${this.activeConnection.hash}`;
      const payload = {
        funcion: "SDC_CUsers",
        parametros: this.contactAppFilter || "",
      };

      const response: any = await invoke("api_post_request", {
        ip: this.activeConnection.ip_address,
        port: Number(this.activeConnection.port),
        endpoint,
        payload,
        hash: this.activeConnection.hash,
        tempAuthToken: this.activeConnection.jwt,
      });

      if (response && Array.isArray(response)) {
        const remoteLogins = new Set(response.map((c: any) => (c.login || c.user_name || "").toLowerCase()));
        const localOnly = this.contacts.filter(
          (c) => !remoteLogins.has((c.login || "").toLowerCase())
        );
        this.contacts = [...response, ...localOnly];
        this.saveContactsLocal();
      } else if (response?.data && Array.isArray(response.data)) {
        this.contacts = response.data;
        this.saveContactsLocal();
      } else if (response?.msj === "Ok" && response.contenido) {
        this.contacts = Array.isArray(response.contenido) ? response.contenido : [];
        this.saveContactsLocal();
      }

      // Cargar sesiones activas SOLO si hay JWT válido
      if (this.isLoggedIn()) {
        await this.loadActiveUsers();
      } else {
        this.activeUsers = [];   // Limpiar cualquier dato previo
      }
    } catch (e) {
      console.warn("Contacts sync error:", e);
    } finally {
      this.isContactsSyncing = false;
    }
  }

  async loadActiveUsers() {
    if (!this.activeConnection || !this.config) return;
    if (!this.isLoggedIn()) { this.activeUsers = []; return; }  // Guard JWT
    try {
      const storage = this.config.access.jwtStorage === "sessionStorage" ? sessionStorage : localStorage;
      const token = storage.getItem(this.config.access.jwtVariableName);
      const response = await this.sdcService.apiPostRequest(
        this.activeConnection.ip_address,
        this.activeConnection.port,
        "v1/api/sandra_get-active-sessions",
        {},
        this.activeConnection.hash,
        token
      );
      if (response && Array.isArray(response)) {
        this.activeUsers = response.map((u: any) => ({
          name: u.name || u.Username || u.User || "Terminal",
          uuid: u.uuid || u.ID || u.Uuid || "",
          initial: (u.name || u.Username || "T").charAt(0).toUpperCase(),
        }));
        this.conversations.forEach((c) => {
          c.isOnline = c.isSandra || this.activeUsers.some((u) => u.uuid === c.id);
        });
      }
    } catch {}
  }

  // ─── Persistence ──────────────────────────────────────────────────────────

  private storageKey(id: string) {
    return `sdc_chat_${this.activeConnection?.id || "default"}_${id}`;
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
        } catch {}
      }
    }
    const convListKey = `sdc_chat_convs_${this.activeConnection?.id || "default"}`;
    const raw = localStorage.getItem(convListKey);
    if (raw) {
      try {
        const savedConvs: Array<{ id: string; name: string; initial: string }> = JSON.parse(raw);
        for (const sc of savedConvs) {
          if (sc.id === "sandra") continue;
          let conv = this.conversations.find((c) => c.id === sc.id);
          if (!conv) {
            conv = { id: sc.id, name: sc.name, initial: sc.initial, isSandra: false, messages: [], unread: 0, isOnline: false };
            this.conversations.push(conv);
          }
          const msgRaw = localStorage.getItem(this.storageKey(sc.id));
          if (msgRaw) {
            try {
              conv.messages = JSON.parse(msgRaw).map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }));
              this.updatePreview(conv);
            } catch {}
          }
        }
      } catch {}
    }
  }

  private saveConvList() {
    const key = `sdc_chat_convs_${this.activeConnection?.id || "default"}`;
    localStorage.setItem(key, JSON.stringify(this.conversations.map((c) => ({ id: c.id, name: c.name, initial: c.initial }))));
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

  /** Elimina una conversación (no se puede eliminar Sandra) */
  deleteConversation(conv: Conversation, event: Event) {
    event.stopPropagation();
    if (conv.isSandra) return; // Proteger conv Sandra
    this.conversations = this.conversations.filter((c) => c.id !== conv.id);
    localStorage.removeItem(this.storageKey(conv.id));
    this.saveConvList();
    if (this.activeConv?.id === conv.id) {
      this.activeConv = null;
      this.view = 'conversations';
    }
  }

  // ─── Start conversation from contact ──────────────────────────────────────

  startConvWithContact(contact: Contact) {
    const id = contact.uuid || contact.login || contact.user_name || this.getContactName(contact);
    const name = this.getContactName(contact);
    const initial = this.getContactInitial(contact);

    let conv = this.conversations.find((c) => c.id === id);
    if (!conv) {
      conv = { id, name, initial, isSandra: false, messages: [], unread: 0, isOnline: this.isContactOnline(contact) };
      this.conversations.push(conv);
      this.saveConvList();
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

    const msg: ChatMessage = { text: userText, sender: "user", timestamp: new Date(), status: "pending" };
    conv.messages.push(msg);
    this.saveConversation(conv);

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
    try {
      const storage = this.config.access.jwtStorage === "sessionStorage" ? sessionStorage : localStorage;
      const token = storage.getItem(this.config.access.jwtVariableName);
      if (!token) { msg.status = "pending"; return; }
      await this.sdcService.apiPostRequest(
        this.activeConnection.ip_address, this.activeConnection.port,
        "v1/api/sandra_send-message",
        { Type: "chat", To: conv.id, Message: msg.text, From: this.clientId },
        this.activeConnection.hash, token
      );
      msg.status = "sent";
      this.saveConversation(conv);
    } catch { msg.status = "pending"; }
  }

  private routeIncomingMessage(from: string, text: string) {
    let conv = this.conversations.find((c) => c.id === from || c.name.toLowerCase() === from.toLowerCase());
    if (!conv) conv = this.getSandraConv();
    if (!conv) return;
    if (!this.isOpen || this.activeConv?.id !== conv.id) conv.unread++;
    this.typeWriterEffect(text, from, conv);
  }

  private checkAndSendPendingMessages() {
    if (!this.activeConv) return;
    const pending = this.activeConv.messages.filter((m) => m.sender === "user" && m.status === "pending");
    if (pending.length > 0) {
      pending.forEach((msg) => {
        if (this.activeConv?.isSandra) this.deliverToSandra(msg, this.activeConv);
        else if (this.activeConv) this.deliverToUser(msg, this.activeConv);
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

  loadHistoryGroups() {
    const raw = localStorage.getItem("sandra_chat_history");
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
    const history = JSON.parse(localStorage.getItem("sandra_chat_history") || "[]");
    history.push(session);
    localStorage.setItem("sandra_chat_history", JSON.stringify(history));
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
    if (this.confirmModal.type === "single" && this.confirmModal.session) {
      const idx = this.historyGroups.findIndex((g) => g.id === this.confirmModal.session.id);
      if (idx > -1) {
        this.historyGroups.splice(idx, 1);
        localStorage.setItem("sandra_chat_history", JSON.stringify(this.historyGroups));
      }
    } else if (this.confirmModal.type === "all") {
      localStorage.removeItem("sandra_chat_history");
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
    } catch {}
  }

  handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); this.sendMessage(); }
  }

  onInput(event: any) {
    const ta = event.target;
    ta.style.height = "40px";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }

  private resetTextareaHeight() {
    setTimeout(() => {
      const ta = document.querySelector(".input-wrapper textarea") as HTMLTextAreaElement;
      if (ta) ta.style.height = "40px";
    }, 0);
  }
}
