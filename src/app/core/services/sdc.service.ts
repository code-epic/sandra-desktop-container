import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { SystemStats } from '../models/telemetry.model';

@Injectable({
  providedIn: 'root'
})
export class SdcService {

  constructor() { }

  // Método para obtener la telemetría del hardware
  async getSystemTelemetry(): Promise<SystemStats> {
    try {
      return await invoke<SystemStats>('get_system_telemetry');
    } catch (error) {
      console.error('Error capturando telemetría SDC:', error);
      throw error;
    }
  }
  // 1. Obtener IPs
  async getNetworkInfo(): Promise<string[]> {
    return await invoke<string[]>('get_network_info');
  }

  // 2. Espacio en disco (Ya incluido en getSystemTelemetry, pero podemos aislarlo)
  async getDiskUsage() {
    const stats = await this.getSystemTelemetry();
    return { free: stats.disk_free, total: stats.disk_total, name: 'System Storage' };
  }

  async getDbStats(): Promise<any> {
    return await invoke('get_db_stats');
  }

  // 3. Reiniciar equipo
  async requestRemoteReboot() {
    const confirmacion = confirm("¿Está seguro de reiniciar el equipo remotamente?");
    if (confirmacion) {
      return await invoke<string>('remote_reboot');
    }
    return "Reinicio cancelado";
  }

  // Connection Management
  async getConnections(): Promise<any[]> {
    return await invoke('get_connections');
  }

  async saveConnection(connection: any): Promise<void> {
    return await invoke('save_connection', { connData: connection });
  }

  async deleteConnection(id: number): Promise<void> {
    return await invoke('delete_connection', { id });
  }

  async connectToServer(connection: any, clientId: string): Promise<void> {
    return await invoke('connect_to_server', { connData: connection, clientId });
  }

  async disconnectFromServer(connection: any, clientId: string): Promise<void> {
    return await invoke('disconnect_from_server', { connData: connection, clientId });
  }



  async getClientId(): Promise<string> {
    return await invoke('get_or_create_client_id');
  }
}