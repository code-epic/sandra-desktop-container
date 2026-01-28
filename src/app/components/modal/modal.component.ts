import { Component, EventEmitter, Input, Output } from "@angular/core";
import { CommonModule } from "@angular/common";

export type ModalType =
  | "info"
  | "success"
  | "warning"
  | "error"
  | "loading"
  | "custom";

@Component({
  selector: "app-modal",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./modal.component.html",
  styleUrl: "./modal.component.css",
})
export class ModalComponent {
  @Input() title: string = "";
  @Input() message: string = "";
  @Input() type: ModalType = "info";

  // Customization
  @Input() width: string = "400px";
  @Input() showCloseButton: boolean = false;
  @Input() showIcon: boolean = true;

  // Loading State (overlays or replaces content)
  @Input() isLoading: boolean = false;
  @Input() loadingText: string = "Procesando...";

  // Actions
  @Input() cancelText: string = "Cancelar";
  @Input() confirmText: string = "Aceptar";
  @Input() showCancel: boolean = true;
  @Input() showConfirm: boolean = true;
  @Input() confirmStyle: "primary" | "danger" | "success" | "default" =
    "primary";

  @Output() cancel = new EventEmitter<void>();
  @Output() confirm = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  // Icons mapping
  get iconClass(): string {
    switch (this.type) {
      case "info":
        return "fas fa-info-circle";
      case "success":
        return "fas fa-check-circle";
      case "warning":
        return "fas fa-exclamation-triangle";
      case "error":
        return "fas fa-times-circle";
      case "loading":
        return "fas fa-circle-notch fa-spin";
      default:
        return "";
    }
  }

  get iconColorClass(): string {
    return this.type; // CSS classes .info, .success, etc.
  }

  get confirmButtonClass(): string {
    switch (this.confirmStyle) {
      case "danger":
        return "btn-modal-confirm"; // Red
      case "success":
        return "btn-modal-acept"; // Green
      case "primary":
      default:
        return "btn-modal-primary"; // Blue/Purple
    }
  }

  onCancel() {
    this.cancel.emit();
    this.close.emit();
  }

  onConfirm() {
    this.confirm.emit();
  }

  onOverlayClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      this.cancel.emit(); // Default behavior: click outside cancels/closes
    }
  }
}
