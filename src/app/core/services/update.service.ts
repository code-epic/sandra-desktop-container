import { Injectable, NgZone } from '@angular/core';
import { check } from '@tauri-apps/plugin-updater';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import { BehaviorSubject } from 'rxjs';

export interface UpdateStatus {
  checking: boolean;
  available: boolean;
  version?: string;
  body?: string;
  downloading: boolean;
  progress: number;
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class UpdateService {
  private status = new BehaviorSubject<UpdateStatus>({
    checking: false,
    available: false,
    downloading: false,
    progress: 0
  });

  status$ = this.status.asObservable();

  constructor(private ngZone: NgZone) {}

  /**
   * Checks for available updates on the remote repository.
   * @param silent If true, don't show "No updates" dialog
   */
  async checkAndPrompt(silent: boolean = false) {
    try {
      this.updateState({ checking: true, error: undefined });
      
      const update = await check();
      
      if (update) {
        this.updateState({ 
          checking: false, 
          available: true, 
          version: update.version,
          body: update.body 
        });

        const shouldInstall = await ask(
          `Una nueva versión (${update.version}) está disponible.\n\n${update.body}\n\n¿Deseas descargar e instalar ahora?`,
          { title: 'Sincronización de Sistema', kind: 'info' }
        );

        if (shouldInstall) {
          await this.performUpdate(update);
        }
      } else {
        this.updateState({ checking: false, available: false });
        if (!silent) {
          await message('Tu sistema SandraDC ya está en la última versión.', {
            title: 'Sistema Sincronizado',
            kind: 'info'
          });
        }
      }
    } catch (error) {
      if (!silent) {
        console.error('Update check failed:', error);
      } else {
        console.warn('Silent update check failed:', error);
      }
      this.updateState({ checking: false, error: String(error) });
    }
  }

  /**
   * Internal logic to download and install the update with progress tracking.
   */
  private async performUpdate(update: any) {
    try {
      this.updateState({ downloading: true, progress: 0 });

      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event: any) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength || 0;
            console.log(`🚀 Iniciando descarga: ${contentLength} bytes`);
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              const progress = Math.round((downloaded / contentLength) * 100);
              this.ngZone.run(() => {
                this.updateState({ progress });
              });
            }
            break;
          case 'Finished':
            console.log('✅ Descarga completada');
            this.ngZone.run(() => {
              this.updateState({ downloading: false, progress: 100 });
            });
            break;
        }
      });

      const confirmRestart = await ask(
        'La actualización se ha descargado correctamente. El sistema necesita reiniciarse para aplicar los cambios.',
        { title: 'Instalación Lista', kind: 'info' }
      );

      if (confirmRestart) {
        await relaunch();
      }
    } catch (error) {
      console.error('Download failed:', error);
      this.updateState({ downloading: false, error: 'Error al descargar la actualización.' });
    }
  }

  private updateState(newState: Partial<UpdateStatus>) {
    this.status.next({ ...this.status.value, ...newState });
  }
}
