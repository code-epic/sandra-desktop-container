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
     * Show a subtle message near the mouse cursor or center of screen
     * @param message Text to show
     * @param event The mouse event to extract coordinates (optional)
     * @param type Visual style
     * @param icon Optional FontAwesome icon (if null, uses default for type)
     */
    show(message: string, event?: MouseEvent, type: 'success' | 'info' | 'error' | 'warning' = 'success', icon?: string) {
        if (!icon) {
            switch (type) {
                case 'success': icon = 'fa-check-circle'; break;
                case 'info': icon = 'fa-info-circle'; break;
                case 'error': icon = 'fa-times-circle'; break;
                case 'warning': icon = 'fa-exclamation-triangle'; break;
            }
        }

        const x = event ? event.clientX : window.innerWidth / 2;
        const y = event ? event.clientY : window.innerHeight / 2;

        this.snapSubject.next({
            message,
            x,
            y,
            type,
            icon
        });
    }
}
