import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';

export interface MailboxMessage {
    id: number;
    sid: string;
    content: string;
    author: string;
    status: 'Pending' | 'Read' | 'Approved' | 'Rejected';
    tracking_info?: string;
    responsible?: string;
    created_at: string;
    updated_at: string;
    is_read: boolean;
    direction?: 'inbox' | 'outbox';
    attachments?: Array<{
        name: string;
        type: 'PDF' | 'SSE';
        path: string; // Virtual path or ID
    }>;
}

export interface SecurityConfig {
    id: number;
    password_format_regex: string;
    reporting_level: string;
    audit_level: string;
    cache_enabled: boolean;
}

export interface ProxyRoute {
    id: number;
    route_path: string;
    target_database?: string;
    code?: string;
    description?: string;
    is_active: boolean;
}

export interface AuthorizationTicket {
    auth_id: string;
    payload: string;
    content: string;
    status: 'pendiente' | 'en proceso' | 'procesado' | 'notificado';
    created_at: string;
    updated_at: string;
}

@Injectable({
    providedIn: 'root'
})
export class SecurityService {

    // --- Mailbox ---
    async getMailboxMessages(): Promise<MailboxMessage[]> {
        return invoke('get_mailbox_messages');
    }

    async createMailboxMessage(message: Partial<MailboxMessage>) {
        return invoke('create_mailbox_message', {
            sid: message.sid,
            content: message.content,
            author: message.author,
            responsible: message.responsible,
            direction: message.direction || 'outbox'
        });
    }

    async updateMailboxStatus(id: number, status: string, trackingInfo?: string) {
        return invoke('update_mailbox_status', { id, status, trackingInfo });
    }

    async deleteMailboxMessage(id: number) {
        return invoke('delete_mailbox_message', { id });
    }

    // --- Config ---
    async getSecurityConfig(): Promise<SecurityConfig> {
        return invoke('get_security_config');
    }

    async updateSecurityConfig(config: Partial<SecurityConfig>) {
        // Rust args: password_format_regex, reporting_level, audit_level, cache_enabled
        // Tauri auto-converts camelCase keys to snake_case args
        return invoke('update_security_config', {
            passwordFormatRegex: config.password_format_regex,
            reportingLevel: config.reporting_level,
            auditLevel: config.audit_level,
            cacheEnabled: config.cache_enabled
        });
    }

    // --- Proxy Routes ---
    async getProxyRoutes(): Promise<ProxyRoute[]> {
        return invoke('get_proxy_routes');
    }

    async createProxyRoute(route: Partial<ProxyRoute>) {
        return invoke('create_proxy_route', {
            routePath: route.route_path,
            targetDatabase: route.target_database,
            code: route.code,
            description: route.description
        });
    }

    async deleteProxyRoute(id: number) {
        return invoke('delete_proxy_route', { id });
    }

    // --- Authorization Tickets ---
    async getAuthorizationTickets(): Promise<AuthorizationTicket[]> {
        return invoke('get_authorization_tickets');
    }

    async deleteAuthorizationTicket(authId: string) {
        return invoke('delete_authorization_ticket', { authId });
    }

    async updateAuthorizationTicketStatus(authId: string, status: string) {
        return invoke('update_authorization_ticket_status', { authId, status });
    }
}
