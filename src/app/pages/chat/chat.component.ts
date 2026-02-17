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
import { Subscription } from "rxjs";

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
  @ViewChild("scrollContainer") privatescrollContainer!: ElementRef;

  isOpen = false;
  isLoading = true; // Initial loading state
  newMessage = "";
  messages: ChatMessage[] = [];
  isTyping = false;
  unreadCount = 0;

  constructor(private wsService: WebSocketService) { }

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

  sendMessage() {
    if (!this.newMessage.trim()) return;

    // Add User Message
    this.messages.push({
      text: this.newMessage,
      sender: "user",
      timestamp: new Date(),
    });

    const userText = this.newMessage;
    this.newMessage = "";
    this.isTyping = true;
    this.scrollToBottom();

    // Simulate AI Processing & Typing Effect
    setTimeout(
      () => {
        this.simulateResponse(userText);
      },
      1000 + Math.random() * 1000,
    ); // 1-2s delay
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
