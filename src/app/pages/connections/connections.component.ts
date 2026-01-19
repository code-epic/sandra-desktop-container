import { Component, EventEmitter, OnInit, Output, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface Connection {
  id?: number;
  name: string;
  ip_address: string;
  port: number;
  username?: string;
  password?: string;
  last_connected?: string;
  wss_host?: string;
  wss_port?: number;
  is_connected?: boolean;
}

@Component({
  selector: 'app-connections',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './connections.component.html',
  styleUrls: ['./connections.component.css']
})
export class ConnectionsComponente implements OnInit, OnDestroy {
  // Identity
  clientId: string = '---';
  localIp: string = '---';

  // List
  savedConnections: Connection[] = [];

  // Form
  form: Connection = {
    name: 'Nueva Conexión',
    ip_address: '',
    port: 22,
    username: '',
    password: ''
  };

  // Logic State
  verifyStatus: 'idle' | 'checking' | 'success' | 'error' = 'idle';
  isHostAvailable: boolean = false;
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';

  // Modal State
  showModal: boolean = false;
  connProgress: number = 0;
  connStatusMsg: string = '';

  // Confetti Modal
  showWelcomeModal: boolean = false;

  private unlistenFn: any;

  constructor(private cdr: ChangeDetectorRef) { }

  async ngOnInit() {
    this.loadSystemData();
    this.loadSavedConnections();

    // Listen to global connection status
    this.unlistenFn = await listen('connection-status', (event: any) => {
      const status = event.payload as string; // connecting, connected, disconnected, error
      console.log('Connection Status Event:', status);

      this.connectionState = status as any;

      if (status === 'connecting') {
        this.showModal = true;
        this.connStatusMsg = 'Estableciendo enlace seguro...';
        this.connProgress = 30;
      } else if (status === 'connected') {
        this.connProgress = 100;
        this.connStatusMsg = '¡Conectado!';
        setTimeout(() => {
          this.showModal = false;
          this.showWelcomeModal = true;
        }, 800);
      } else if (status === 'error') {
        this.connStatusMsg = 'Error en la conexión.';
        this.verifyStatus = 'error';
        setTimeout(() => { this.showModal = false; }, 2000);
      }
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy() {
    if (this.unlistenFn) this.unlistenFn();
  }

  async loadSystemData() {
    try {
      this.clientId = await invoke('get_or_create_client_id');
      this.localIp = await invoke('get_local_ip');
    } catch (error) {
      console.error('Failed to load system data', error);
    }
  }

  copyId() {
    navigator.clipboard.writeText(this.clientId);
  }

  async loadSavedConnections() {
    try {
      this.savedConnections = await invoke('get_connections');
    } catch (error) {
      console.error('Failed to load connections', error);
    }
  }

  // --- Verification Logic ---
  private debounceTimer: any;
  onAddressChange() {
    this.verifyStatus = 'idle';
    this.isHostAvailable = false;

    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    // Validar ip basico
    if (this.form.ip_address.length < 3) return;

    this.debounceTimer = setTimeout(() => {
      this.verifyHost();
    }, 800);
  }

  async verifyHost() {
    this.verifyStatus = 'checking';
    try {
      const isUp = await invoke('verify_connection_status', {
        ip: this.form.ip_address,
        port: Number(this.form.port)
      });

      if (isUp) {
        this.verifyStatus = 'success';
        this.isHostAvailable = true;
      } else {
        this.verifyStatus = 'error';
        this.isHostAvailable = false;
      }
    } catch (err) {
      this.verifyStatus = 'error';
      this.isHostAvailable = false;
    }
  }

  // --- CRUD ---
  selectConnection(conn: Connection) {
    this.form = { ...conn }; // Copy
    this.verifyHost(); // Re-verify selected
  }

  resetForm() {
    this.form = {
      name: 'Nueva Conexión',
      ip_address: '',
      port: 22,
      username: '',
      password: ''
    };
    this.form.id = undefined;
    this.verifyStatus = 'idle';
  }

  async save() {
    if (!this.form.name || !this.form.ip_address) return;
    try {
      await invoke('save_connection', { connData: this.form });
      await this.loadSavedConnections();
    } catch (err) {
      console.error(err);
      alert('Error al guardar: ' + err);
    }
  }

  async deleteConn(e: Event, id: number) {
    e.stopPropagation();
    if (!confirm('¿Eliminar conexión?')) return;
    try {
      await invoke('delete_connection', { id });
      await this.loadSavedConnections();
      if (this.form.id === id) this.resetForm();
    } catch (err) {
      console.error(err);
    }
  }

  // --- Connect/Disconnect Action ---
  async connect() {
    // Toggle Logic
    if (this.connectionState === 'connected') {
      await this.disconnect();
      return;
    }

    if (!this.isHostAvailable) return;

    try {
      await invoke('connect_to_server', {
        connData: this.form,
        clientId: this.clientId
      });
    } catch (err) {
      console.error("Failed to trigger connection", err);
      alert("Error al iniciar conexión: " + err);
    }
  }

  async disconnect() {
    if (!confirm('¿Desea cerrar la conexión con el servidor ' + this.form.name + '?')) return;
    try {
      await invoke('disconnect_from_server', {
        connData: this.form,
        clientId: this.clientId
      });
      // State update handled by event listener
    } catch (err) {
      console.error("Failed to disconnect", err);
    }
  }

  closeWelcome() {
    this.showWelcomeModal = false;
  }
}
