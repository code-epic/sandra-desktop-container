import { Injectable, NgZone } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { BehaviorSubject, Observable } from 'rxjs';

export interface UploadProgressEvent {
  loaded: number;
  total: number;
  progress: number;
  state: 'IDLE' | 'LOADING' | 'DONE' | 'ERROR';
  body?: any;
}

@Injectable({
  providedIn: 'root'
})
export class FileService {

  constructor(private zone: NgZone) { }

  /**
   * Procesa un archivo en Rust (esteganografía/firma) y lo sube al servidor Go remoto.
   * @param filePath Ruta absoluta del archivo (obtenida via Tauri dialog o similar)
   * @param metadata Metadatos del archivo (correo_id, nombre_usuario, etc.)
   * @param connection Conexión activa para obtener IP, puerto, hash y JWT.
   */
  async uploadFileRust(
    filePath: string,
    metadata: any,
    connection: any
  ): Promise<Observable<UploadProgressEvent>> {
    const progress$ = new BehaviorSubject<UploadProgressEvent>({
      loaded: 0,
      total: 100,
      progress: 0,
      state: 'IDLE'
    });

    // 1. Escuchar eventos de progreso desde Rust
    const unlisten = await listen('upload-progress', (event: any) => {
      this.zone.run(() => {
        progress$.next({
          loaded: event.payload.loaded,
          total: event.payload.total,
          progress: event.payload.percent,
          state: 'LOADING'
        });
      });
    });

    // 2. Disparar el proceso pesado en Rust
    invoke('process_and_upload', {
      filePath,
      metadata,
      ip: connection.ip_address,
      port: connection.port,
      endpoint: 'v1/api/subirarchivos', // Endpoint por defecto para subidas
      hash: connection.hash,
      tempAuthToken: connection.jwt || null
    })
      .then((response) => {
        this.zone.run(() => {
          progress$.next({
            loaded: 100,
            total: 100,
            progress: 100,
            state: 'DONE',
            body: response
          });
        });
        unlisten();
      })
      .catch((err) => {
        this.zone.run(() => {
          console.error("Error en upload nativo:", err);
          progress$.next({
            loaded: 0,
            total: 100,
            progress: 0,
            state: 'ERROR',
            body: err
          });
        });
        unlisten();
      });

    return progress$.asObservable();
  }
}
