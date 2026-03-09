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
  @ViewChild("scrollContainer") privatescrollContainer!: ElementRef;

  isOpen = false;
  isLoading = true; // Initial loading state
  newMessage = "";
  messages: ChatMessage[] = [];
  isTyping = false;
  unreadCount = 0;

  constructor(
    private wsService: WebSocketService,
    private sdcService: SdcService
  ) { }

  ngOnInit() {
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
  }

  ngOnDestroy() {
    this.chatSub?.unsubscribe();
  }

  ngAfterViewChecked() {
    this.scrollToBottom();
  }

  scrollToBottom(): void {
    try {
      if (this.privatescrollContainer) {
        this.privatescrollContainer.nativeElement.scrollTop =
          this.privatescrollContainer.nativeElement.scrollHeight;
      }
    } catch (err) { }
  }

  toggleChat() {
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      this.unreadCount = 0;
    }
  }

  async sendMessage() {
    if (!this.newMessage.trim()) return;

    const userText = this.newMessage;
    this.newMessage = "";

    // Add User Message UI
    this.messages.push({
      text: userText,
      sender: "user",
      timestamp: new Date(),
    });

    this.isTyping = true;
    this.scrollToBottom();

    // 1. Send via API (Tauri api_post_request)
    console.log(this.activeConnection);
    if (this.activeConnection && this.config) {
      try {
        const endpoint = "v1/api/sandra_send-message";
        const storage = this.config.access.jwtStorage === "sessionStorage" ? sessionStorage : localStorage;
        const token = storage.getItem(this.config.access.jwtVariableName);

        let fromValue = "Anonymous";
        if (token) {
          try {
            const payloadPart = token.split(".")[1];
            const decoded = JSON.parse(atob(payloadPart));
            // User requested: From: JWT.usuario.login_session
            fromValue = decoded.Usuario?.login_session || decoded.Usuario?.Nombre || "SandraUser";
          } catch (e) {
            console.error("Error decoding JWT for chat", e);
          }
        }

        const payload = {
          Type: "chat",
          ID: "", // Se envía el clientId (Session ID) como solicitó el usuario
          Message: userText,
          From: this.clientId,
          To: "xterm",
          Timestamp: new Date().toISOString(),
          Status: "pending" // Conservar status
        };

        console.log(payload);

        await this.sdcService.apiPostRequest(
          this.activeConnection.ip_address,
          this.activeConnection.port,
          endpoint,
          payload,
          this.activeConnection.hash,
          token
        );
      } catch (err) {
        console.error("Error sending message via API:", err);
      }
    }

    // 2. Simulate AI Processing & Typing Effect locally (or wait for WS response)
    // For now keep the simulation as fallback or until WS event confirms
    setTimeout(
      () => {
        this.simulateResponse(userText);
      },
      1000 + Math.random() * 1000,
    );
  }

  simulateResponse(userQuery: string) {
    this.isTyping = false;
    let responseText = "Entendido, procesando tu solicitud...";

    // Simple mocked logic for demo
    if (userQuery.toLowerCase().includes("hola")) {
      responseText = "¡Hola! Estoy en línea y conectada al núcleo.";
    } else if (userQuery.toLowerCase().includes("status")) {
      responseText = `El estado actual del sistema es: ${this.wsStatus}`;
    } else if (userQuery.toLowerCase().includes("ayuda")) {
      responseText =
        "Puedo ayudarte a gestionar apps, monitorear la red o ejecutar comandos remotos.";
    }

    this.typeWriterEffect(responseText);
  }

  typeWriterEffect(text: string, from: string = "Sandra") {
    const msg: ChatMessage = {
      text: "",
      sender: "sandra",
      from: from,
      timestamp: new Date(),
      isTyping: true,
    };
    this.messages.push(msg);

    let i = 0;
    const speed = 30; // ms per char

    const type = () => {
      if (i < text.length) {
        msg.text += text.charAt(i);
        i++;
        setTimeout(type, speed);
      } else {
        msg.isTyping = false;
      }
      this.scrollToBottom();
    };

    type();
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
    this.scrollToBottom();
  }

  attachFile() {
    alert("Funcionalidad de adjuntar archivos próximamente.");
  }
}
