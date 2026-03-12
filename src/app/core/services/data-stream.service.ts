import { Injectable, NgZone } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class DataStreamService {
  constructor(private zone: NgZone) {}

  /**
   * Invokes the Rust streaming API and returns an Observable that emits NDJSON objects.
   */
  streamPostRequest<T>(
    ip: string,
    port: number,
    endpoint: string,
    payload: any,
    hash: string,
    tempAuthToken: string | null = null
  ): Observable<T> {
    return new Observable<T>(subscriber => {
      let unlistenData: UnlistenFn | null = null;
      let unlistenDone: UnlistenFn | null = null;
      
      const eventChannel = `stream_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

      // Listen for data chunks
      listen<string>(eventChannel, (event) => {
        this.zone.run(() => {
          try {
            const text = event.payload.trim();
            if (text) {
              const data = JSON.parse(text) as T;
              subscriber.next(data);
            }
          } catch (e) {
            console.error("Error parsing NDJSON chunk:", e, event.payload);
          }
        });
      }).then(unlisten => {
        unlistenData = unlisten;
      });

      // Listen for completion
      listen<string>(`${eventChannel}_done`, () => {
        this.zone.run(() => {
          subscriber.complete();
        });
      }).then(unlisten => {
        unlistenDone = unlisten;
      });

      // Invoke the Rust command
      invoke('api_post_stream_request', {
        ip,
        port,
        endpoint,
        payload,
        hash,
        tempAuthToken,
        eventChannel
      }).catch(err => {
        this.zone.run(() => {
          subscriber.error(err);
        });
      });

      // Cleanup on unsubscribe
      return () => {
        if (unlistenData) {
          unlistenData();
        }
        if (unlistenDone) {
          unlistenDone();
        }
      };
    });
  }
}
