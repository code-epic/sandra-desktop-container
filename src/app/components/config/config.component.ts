import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-config',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './config.component.html',
  styleUrls: ['./config.component.css']
})
export class ConfigComponent {
  @Input() config: any;
  @Input() networkInfo: string[] = [];
  @Input() availableConnections: any[] = [];
  @Input() activeConnection: any;

  @Output() close = new EventEmitter<void>();
  @Output() onSave = new EventEmitter<void>();
  @Output() onActivateConnection = new EventEmitter<any>();
  @Output() onDisconnect = new EventEmitter<any>();

  activeConfigTab: string = 'logs';

  saveConfig() {
    this.onSave.emit();
  }

  activateConnectionGlobal(conn: any) {
    this.onActivateConnection.emit(conn);
  }

  disconnect(conn: any) {
    this.onDisconnect.emit(conn);
  }

  closeModal() {
    this.close.emit();
  }
}
