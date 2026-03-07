import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

/**
 * Global Snap Message Service
 * Discreet feedback shown at mouse position
 */
export interface SnapData {
    message: string;
    x: number;
    y: number;
    type?: 'success' | 'info' | 'error' | 'warning';
    icon?: string;
}

@Injectable({
    providedIn: 'root'
})
export class SnapService {
    private snapSubject = new Subject<SnapData>();
    snap$ = this.snapSubject.asObservable();

    /**
     * Show a subtle message near the mouse cursor
     * @param message Text to show
     * @param event The mouse event to extract coordinates
     * @param type Visual style
     * @param icon Optional FontAwesome icon (if null, uses default for type)
     */
    show(message: string, event: MouseEvent, type: 'success' | 'info' | 'error' | 'warning' = 'success', icon?: string) {
        if (!icon) {
            switch (type) {
                case 'success': icon = 'fa-check-circle'; break;
                case 'info': icon = 'fa-info-circle'; break;
                case 'error': icon = 'fa-times-circle'; break;
                case 'warning': icon = 'fa-exclamation-triangle'; break;
            }
        }

        this.snapSubject.next({
            message,
            x: event.clientX,
            y: event.clientY,
            type,
            icon
        });
    }
}
