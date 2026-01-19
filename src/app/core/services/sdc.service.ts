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
    return stats.disks;
  }

  // 3. Reiniciar equipo
  async requestRemoteReboot() {
    const confirmacion = confirm("¿Está seguro de reiniciar el equipo remotamente?");
    if (confirmacion) {
      return await invoke<string>('remote_reboot');
    }
    return "Reinicio cancelado";
  }
}