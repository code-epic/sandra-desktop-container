import { Injectable, NgZone } from '@angular/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { BehaviorSubject, Subject } from 'rxjs';

export interface ChatMessage {
    id?: string;
    message: string;
    from: string;
    type: string;
    timestamp: Date;
}

export interface SystemNotification {
    id?: string;
    title?: string;
    message: string;
    from?: string;
    timestamp: Date;
}

@Injectable({
    providedIn: 'root'
})
export class WebSocketService {
    private chatMessagesSubject = new Subject<ChatMessage>();
    chatMessages$ = this.chatMessagesSubject.asObservable();

    private notificationsSubject = new Subject<SystemNotification>();
    notifications$ = this.notificationsSubject.asObservable();

    private operationsSubject = new Subject<any>();
    operations$ = this.operationsSubject.asObservable();

    private connectionStatusSubject = new BehaviorSubject<string>('disconnected');
    connectionStatus$ = this.connectionStatusSubject.asObservable();

    private unlistenFns: UnlistenFn[] = [];

    constructor(private ngZone: NgZone) {
        this.initListeners();
    }

    private async initListeners() {
        // 1. Connection Status
        const unlistenStatus = await listen('connection-status', (event: any) => {
            this.ngZone.run(() => {
                this.connectionStatusSubject.next(event.payload);
            });
        });
        this.unlistenFns.push(unlistenStatus);

        // 2. Chat Messages
        const unlistenChat = await listen('chat-message', (event: any) => {
            this.ngZone.run(() => {
                const payload = event.payload;
                this.chatMessagesSubject.next({
                    id: payload.id,
                    message: payload.message,
                    from: payload.from || 'Sistema',
                    type: 'chat',
                    timestamp: new Date()
                });
            });
        });
        this.unlistenFns.push(unlistenChat);

        // 3. System Notifications
        const unlistenNotify = await listen('system-notification', (event: any) => {
            this.ngZone.run(() => {
                const payload = event.payload;
                this.notificationsSubject.next({
                    id: payload.id,
                    title: payload.title || payload.from,
                    message: payload.message,
                    from: payload.from,
                    timestamp: new Date()
                });
            });
        });
        this.unlistenFns.push(unlistenNotify);

        // 4. Operations
        const unlistenOps = await listen('operation-event', (event: any) => {
            this.ngZone.run(() => {
                this.operationsSubject.next(event.payload);
            });
        });
        this.unlistenFns.push(unlistenOps);

        // 5. Welcome
        const unlistenWelcome = await listen('server-welcome', (event: any) => {
            this.ngZone.run(() => {
                console.log('🚀 Server Welcome:', event.payload);
            });
        });
        this.unlistenFns.push(unlistenWelcome);
    }

    destroy() {
        this.unlistenFns.forEach(fn => fn());
    }
}
