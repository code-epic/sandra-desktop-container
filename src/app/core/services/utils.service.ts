import { Injectable } from '@angular/core';

/**
 * UtilsService — Helpers reutilizables de la plataforma SDC.
 *
 * Centraliza funciones que estaban duplicadas en múltiples componentes:
 *  - formatBytes()      → app.component.ts L1112, dashboard.component.ts L27
 *  - safeJsonParse()    → 15+ usos de JSON.parse sin try-catch
 *  - Helpers de fecha/tiempo
 */
@Injectable({
  providedIn: 'root'
})
export class UtilsService {

  // ─────────────────────────────────────────────────────────────────────────────
  // 4.3.2 — formatBytes
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Convierte un número de bytes en una cadena legible con unidades automáticas.
   * Ejemplo: formatBytes(1048576) → "1 MB"
   *
   * Reemplaza las implementaciones duplicadas en:
   *  - AppComponent.formatBytes()     → conversión simple a GB solamente
   *  - DashboardComponent.formatBytes() → conversión multi-unidad correcta
   *
   * Nota: se usa la implementación completa de Dashboard (más correcta).
   */
  formatBytes(bytes: number, decimals = 2): string {
    if (bytes === 0) return '0 B';
    if (!isFinite(bytes) || bytes < 0) return '— B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const value = parseFloat((bytes / Math.pow(k, i)).toFixed(decimals));
    return `${value} ${sizes[i]}`;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4.3.3 — safeJsonParse
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Parsea un string JSON de forma segura.
   * Devuelve el valor parseado o `fallback` si hay error.
   *
   * Reemplaza el patrón repetido 15+ veces:
   *   try { JSON.parse(str) } catch(e) { ... }
   *
   * @param json    String a parsear
   * @param fallback Valor por defecto si el parseo falla (default: null)
   */
  safeJsonParse<T>(json: string | null | undefined, fallback: T | null = null): T | null {
    if (!json) return fallback;
    try {
      return JSON.parse(json) as T;
    } catch {
      return fallback;
    }
  }

  /**
   * Parsea JSON almacenado en localStorage de forma segura.
   * Combina localStorage.getItem + safeJsonParse en un solo paso.
   *
   * Reemplaza el patrón:
   *   const raw = localStorage.getItem(key);
   *   if (raw) { try { JSON.parse(raw) } catch {} }
   *
   * @param key       Clave de localStorage
   * @param fallback  Valor por defecto si la clave no existe o el JSON es inválido
   */
  getLocalJson<T>(key: string, fallback: T | null = null): T | null {
    return this.safeJsonParse<T>(localStorage.getItem(key), fallback);
  }

  /**
   * Serializa y guarda un objeto en localStorage como JSON.
   *
   * @param key   Clave de localStorage
   * @param value Objeto a serializar y guardar
   */
  setLocalJson<T>(key: string, value: T): void {
    localStorage.setItem(key, JSON.stringify(value));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4.3.4 — Helpers de Fecha / Tiempo
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Devuelve la fecha actual en formato SDC compacto: "30MAR26"
   * Usado en app.component.ts updateDateTime()
   */
  formatDateCompact(date: Date = new Date()): string {
    const months = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
    const day   = date.getDate().toString().padStart(2, '0');
    const month = months[date.getMonth()];
    const year  = date.getFullYear().toString().slice(-2);
    return `${day}${month}${year}`;
  }

  /**
   * Devuelve la hora en formato HH:MM:SS (24h).
   * Ejemplo: "09:45:03"
   */
  formatTimeHHMMSS(date: Date = new Date()): string {
    return date.toLocaleTimeString('es-ES', { hour12: false });
  }

  /**
   * Devuelve una etiqueta relativa al momento: "Hoy", "Ayer", o la fecha local.
   * Útil para agrupar mensajes/items por fecha en listas.
   */
  getRelativeDateLabel(dateStr: string): string {
    if (!dateStr) return 'Sin fecha';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;

    const now = new Date();
    const today    = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const itemDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.round((today.getTime() - itemDate.getTime()) / 86_400_000);

    if (diffDays === 0) return 'Hoy';
    if (diffDays === 1) return 'Ayer';
    if (diffDays < 7)  return `Hace ${diffDays} días`;
    return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' });
  }

  /**
   * Formatea una fecha ISO como timestamp legible para el buzón.
   * Ejemplo: "30 Mar 26 · 9:45:03 AM"
   */
  formatMailTimestamp(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const datePart = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' });
    const timePart = date.toLocaleTimeString('es-ES', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
    return `${datePart} · ${timePart}`;
  }

  /**
   * Verifica si una fecha está dentro de los últimos N días.
   * Útil para filtros "recientes".
   */
  isWithinDays(dateStr: string, days: number): boolean {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return false;
    const cutoff = new Date(Date.now() - days * 86_400_000);
    return date >= cutoff;
  }
}
