import { Injectable } from '@angular/core';
import { SdcService } from './sdc.service';
import { DataStreamService } from './data-stream.service';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class TicketStateService {

  constructor(
    private sdcService: SdcService,
    private dataStreamService: DataStreamService
  ) { }

  /**
   * Consulta los tickets pendientes o historial de tickets en forma de stream.
   * @param activeConnection La conexión actualmente activa seleccionada por el usuario.
   * @returns Un Observable que emite los tickets conforme llegan.
   */
  async getRemoteTickets(activeConnection: any): Promise<Observable<any>> {
    if (!activeConnection) {
      throw new Error("No hay una conexión activa provista.");
    }

    // 1. Obtener la dirección MAC real del equipo a través de la telemetría
    const stats = await this.sdcService.getSystemTelemetry();
    const macAddress = stats.mac_address;

    // 2. Construir el payload donde 'parametros' es la mac real
    const payload = {
      funcion: "SDC_CTicket",
      parametros: macAddress
    };

    // 3. El endpoint es /v1/api/crud:hash 
    const endpoint = `v1/api/crudstream:${activeConnection.hash}`;

    // 4. Se ejecuta la petición HTTP en streaming hacia el sevidor Go remoto
    return this.dataStreamService.streamPostRequest(
      activeConnection.ip_address,
      activeConnection.port,
      endpoint,
      payload,
      activeConnection.hash,
      activeConnection.jwt || null
    );
  }
}
