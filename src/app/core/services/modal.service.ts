import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export interface GenericModalState {
  show: boolean;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  infoIcon?: string;
}

export interface QuestionModalState {
  show: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
  onCancel: () => void;
}

@Injectable({
  providedIn: 'root'
})
export class ModalService {
  genericModal$ = new Subject<GenericModalState>();
  questionModal$ = new Subject<QuestionModalState>();
  closeAllOverlays$ = new Subject<void>();

  showGenericModal(title: string, message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info', infoIcon?: string) {
    this.closeAllOverlays$.next();
    this.genericModal$.next({ show: true, title, message, type, infoIcon });
  }

  showQuestionModal(title: string, message: string, confirmText: string = 'Aceptar', cancelText: string = 'Cancelar'): Promise<boolean> {
    this.closeAllOverlays$.next();
    return new Promise((resolve) => {
      this.questionModal$.next({
        show: true,
        title,
        message,
        confirmText,
        cancelText,
        onConfirm: () => {
          this.closeQuestionModal();
          resolve(true);
        },
        onCancel: () => {
          this.closeQuestionModal();
          resolve(false);
        }
      });
    });
  }

  closeGenericModal() {
    this.genericModal$.next({ show: false, title: '', message: '', type: 'info' });
  }

  closeQuestionModal() {
    this.questionModal$.next({ show: false, title: '', message: '', confirmText: 'Aceptar', cancelText: 'Cancelar', onConfirm: () => {}, onCancel: () => {} });
  }
}
