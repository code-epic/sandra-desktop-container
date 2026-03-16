import {
  Component,
  Input,
  OnInit,
  ViewChild,
  ElementRef,
  AfterViewChecked,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";

interface ChatMessage {
  text: string;
  sender: "user" | "sandra";
  from?: string;
  timestamp: Date;
  isTyping?: boolean;
  status?: "sent" | "pending" | "error";
}

import { WebSocketService } from "../../core/services/websocket.service";
import { SdcService } from "../../core/services/sdc.service";
import { Subscription } from "rxjs";
import { invoke } from "@tauri-apps/api/core";

@Component({
  selector: "app-chat",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./chat.component.html",
  styleUrls: ["./chat.component.css"],
})
export class ChatComponent implements OnInit, AfterViewChecked {
  private chatSub?: Subscription;
  @Input() wsStatus: string = "Desconectado";
  @Input() activeConnection: any;
  @Input() config: any;
  @Input() clientId: string = "";
  @Input() visible: boolean = true;
  @ViewChild("scrollContainer") privatescrollContainer!: ElementRef;

  isOpen = false;
  isLoading = true; // Initial loading state
  newMessage = "";
  messages: ChatMessage[] = [];
  pendingMessages: ChatMessage[] = []; // Explicit queue for logic, though status: 'pending' in 'messages' is the UI source
  isTyping = false;
  unreadCount = 0;
  isHistoryOpen = false;
  historyGroups: any[] = [];
  private jwtCheckInterval: any;

  constructor(
    private wsService: WebSocketService,
    private sdcService: SdcService
  ) { }

  ngOnInit() {
    this.loadMessagesFromStorage();

    // Escuchar mensajes reales del WebSocket
    this.chatSub = this.wsService.chatMessages$.subscribe(msg => {
      this.addIncomingMessage(msg.from, msg.message);
    });

    // Simular bienvenida inicial si no hay historial
    setTimeout(() => {
      this.isLoading = false;
      if (this.messages.length === 0) {
        this.addSystemMessage("Hola, soy Sandra. ¿En qué puedo ayudarte hoy?");
      }
    }, 1000);

    // Intervalo para revisar JWT y enviar pendientes
    this.jwtCheckInterval = setInterval(() => {
      this.checkAndSendPendingMessages();
    }, 5000); // Revisar cada 5 segundos
  }

  private loadMessagesFromStorage() {
    const saved = localStorage.getItem("sandra_chat_buffer");
    if (saved) {
      try {
        this.messages = JSON.parse(saved).map((m: any) => ({
          ...m,
          timestamp: new Date(m.timestamp)
        }));
      } catch (e) {
        console.error("Error cargando chat desde storage", e);
      }
    }
  }

  private saveMessagesToStorage() {
    localStorage.setItem("sandra_chat_buffer", JSON.stringify(this.messages));
  }

  ngOnDestroy() {
    this.chatSub?.unsubscribe();
    if (this.jwtCheckInterval) {
      clearInterval(this.jwtCheckInterval);
    }
  }

  ngAfterViewChecked() {
    // Only scroll automatically if we are NOT typing a message 
    // to avoid fighting with the typewriter effect
    if (!this.messages.some(m => m.isTyping)) {
       this.scrollToBottom();
    }
  }

  scrollToBottom(): void {
    try {
      if (this.privatescrollContainer) {
        const container = this.privatescrollContainer.nativeElement;
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'auto' // Use auto for instant jump, 'smooth' for user feel
        });
      }
    } catch (err) { }
  }

  toggleChat() {
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      this.unreadCount = 0;
    }
  }

  openHistoryModal() {
    this.isHistoryOpen = true;
    // Cargar historial desde SQLite próximamente
  }

  closeHistoryModal() {
    this.isHistoryOpen = false;
  }

  async sendMessage(event?: Event) {
    if (event) event.preventDefault();
    if (!this.newMessage.trim()) return;

    const userText = this.newMessage;
    this.newMessage = "";
    this.resetTextareaHeight();

    // Crear objeto de mensaje
    const msg: ChatMessage = {
      text: userText,
      sender: "user",
      timestamp: new Date(),
      status: "pending"
    };

    this.messages.push(msg);
    this.saveMessagesToStorage();

    this.isTyping = true; // Show thinking indicator
    await this.processMessageDelivery(msg);
    this.isTyping = false;
    this.scrollToBottom();
  }

  handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  onInput(event: any) {
    const textarea = event.target;
    textarea.style.height = "40px";
    const newHeight = Math.min(textarea.scrollHeight, 120);
    textarea.style.height = newHeight + "px";
  }

  private resetTextareaHeight() {
    setTimeout(() => {
      const textarea = document.querySelector(".input-wrapper textarea") as HTMLTextAreaElement;
      if (textarea) textarea.style.height = "40px";
    }, 0);
  }
  private async processMessageDelivery(msg: ChatMessage) {
    if (!this.activeConnection || !this.config) {
      msg.status = "pending";
      return;
    }

    try {
      const storage = this.config.access.jwtStorage === "sessionStorage" ? sessionStorage : localStorage;
      const token = storage.getItem(this.config.access.jwtVariableName);

      if (!token) {
        msg.status = "pending";
        console.warn("Sin JWT. Mensaje encolado.");
        return;
      }

      const endpoint = "v1/api/sandra_send-message";
      const payload = {
        Type: "chat",
        ID: "",
        Message: msg.text,
        From: this.clientId,
        To: "xterm",
        Timestamp: msg.timestamp.toISOString(),
        Status: "pending"
      };

      const response = await this.sdcService.apiPostRequest(
        this.activeConnection.ip_address,
        this.activeConnection.port,
        endpoint,
        payload,
        this.activeConnection.hash,
        token
      );

      console.log("Chat Server Response:", response);

      // Si la respuesta contiene un mensaje directo, lo procesamos
      if (response && response.Message) {
         this.addIncomingMessage("Sandra", response.Message);
      }

      msg.status = "sent";
      this.saveMessagesToStorage();

    } catch (err) {
      console.error("Error enviando mensaje:", err);
      msg.status = "pending"; // Re-intentar luego
    }
  }

  private checkAndSendPendingMessages() {
    const pending = this.messages.filter(m => m.sender === "user" && m.status === "pending");
    if (pending.length > 0) {
      console.log(`Revisando ${pending.length} mensajes pendientes...`);
      pending.forEach(msg => this.processMessageDelivery(msg));
    }
  }



  typeWriterEffect(text: string, from: string = "Sandra") {
    if (!text) return; // Prevent empty bubbles

    const msg: ChatMessage = {
      text: "",
      sender: "sandra",
      from: from,
      timestamp: new Date(),
      isTyping: true,
    };
    this.messages.push(msg);
    this.saveMessagesToStorage(); // Persist the initial empty bubble
    
    let i = 0;
    const speed = 25;
    
    // Tiny delay to ensure Angular has pushed the new bubble to the DOM
    setTimeout(() => {
      const type = () => {
        if (i < text.length) {
          msg.text += text.charAt(i);
          i++;
          
          // Manual scroll inside loop for real-time tracking
          if (i % 5 === 0) {
            this.scrollToBottom();
          }
          
          setTimeout(type, speed);
        } else {
          msg.isTyping = false;
          this.saveMessagesToStorage(); // Final save
          this.scrollToBottom(); // Final scroll
        }
      };
      type();
    }, 30);
  }

  addIncomingMessage(from: string, text: string) {
    // Si el chat está cerrado, aumentar contador de no leídos
    if (!this.isOpen) {
      this.unreadCount++;
    }

    // Aplicar efecto de escritura para mensajes entrantes de Sandra
    this.typeWriterEffect(text, from);
  }

  addSystemMessage(text: string) {
    this.messages.push({
      text: text,
      from: "Sistema",
      sender: "sandra",
      timestamp: new Date(),
    });
    this.saveMessagesToStorage();
    this.scrollToBottom();
  }

  attachFile() {
    alert("Funcionalidad de adjuntar archivos próximamente.");
  }
}
