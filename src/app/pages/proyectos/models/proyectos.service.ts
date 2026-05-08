/**
 * Servicio de Gestión de Proyectos - Freya SandraDC
 * Maneja la carga, filtrado y exportación de datos de proyectos
 */

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, map } from 'rxjs';
import {
  SistemaProyectoJSON,
  ModuloJSON,
  SubmoduloJSON,
  FuncionalidadJSON,
  FiltrosProyecto,
  EstadisticasProyecto,
  SituacionProyecto,
  FaseProyecto
} from './proyecto.model';

@Injectable({
  providedIn: 'root'
})
export class ProyectosService {
  private sistemaData: SistemaProyectoJSON | null = null;
  private sistemaSubject = new BehaviorSubject<SistemaProyectoJSON | null>(null);
  
  public sistema$ = this.sistemaSubject.asObservable();
  
  constructor(private http: HttpClient) {}
  
  /**
   * Carga el archivo JSON de proyectos
   */
  async cargarDatos(rutaJson: string = 'assets/data/project.json'): Promise<void> {
    try {
      const data = await this.http.get<SistemaProyectoJSON>(rutaJson).toPromise();
      this.sistemaData = data || null;
      this.sistemaSubject.next(this.sistemaData);
    } catch (error) {
      console.error('Error cargando datos de proyectos:', error);
      throw error;
    }
  }
  
  /**
   * Obtiene todos los módulos disponibles
   */
  obtenerModulos(): ModuloJSON[] {
    return this.sistemaData?.modulos || [];
  }
  
  /**
   * Obtiene módulos filtrados por App ID
   */
  obtenerModulosPorApp(appId: string): ModuloJSON[] {
    return this.sistemaData?.modulos.filter(m => m.appId === appId) || [];
  }
  
  /**
   * Obtiene todos los submódulos de un módulo específico
   */
  obtenerSubmodulos(moduloNombre: string): SubmoduloJSON[] {
    const modulo = this.sistemaData?.modulos.find(m => m.nombre === moduloNombre);
    return modulo?.submodulos || [];
  }
  
  /**
   * Obtiene todas las funcionalidades de un submódulo
   */
  obtenerFuncionalidades(moduloNombre: string, submoduloNombre: string): FuncionalidadJSON[] {
    const modulo = this.sistemaData?.modulos.find(m => m.nombre === moduloNombre);
    const submodulo = modulo?.submodulos.find(s => s.nombre === submoduloNombre);
    return submodulo?.funcionalidades || [];
  }
  
  /**
   * Obtiene una funcionalidad por su ID
   */
  obtenerFuncionalidadPorId(id: string): FuncionalidadJSON | undefined {
    for (const modulo of this.sistemaData?.modulos || []) {
      for (const submodulo of modulo.submodulos) {
        const func = submodulo.funcionalidades.find(f => f.id === id);
        if (func) return func;
      }
    }
    return undefined;
  }
  
  /**
   * Filtra funcionalidades según criterios
   */
  filtrarFuncionalidades(filtros: FiltrosProyecto): FuncionalidadJSON[] {
    if (!this.sistemaData) return [];
    
    const resultado: FuncionalidadJSON[] = [];
    
    for (const modulo of this.sistemaData.modulos) {
      // Filtrar por App ID
      if (filtros.appId && modulo.appId !== filtros.appId) continue;
      
      // Filtrar por módulo
      if (filtros.modulo && modulo.nombre !== filtros.modulo) continue;
      
      for (const submodulo of modulo.submodulos) {
        // Filtrar por submódulo
        if (filtros.submodulo && submodulo.nombre !== filtros.submodulo) continue;
        
        for (const func of submodulo.funcionalidades) {
          // Filtrar por texto de búsqueda
          if (filtros.busqueda) {
            const busqueda = filtros.busqueda.toLowerCase();
            const match = 
              func.descripcion.toLowerCase().includes(busqueda) ||
              func.modulo.toLowerCase().includes(busqueda) ||
              func.submodulo.toLowerCase().includes(busqueda) ||
              func.camposExistentes.toLowerCase().includes(busqueda);
            if (!match) continue;
          }
          
          // Filtrar por situación
          if (filtros.situacion !== 'all' && func.situacion !== filtros.situacion) continue;
          
          // Filtrar por estados activos
          if (filtros.estados.dev && func.dev !== 'X') continue;
          if (filtros.estados.qa && func.qa !== 'X') continue;
          if (filtros.estados.pro && func.pro !== 'X') continue;
          
          resultado.push(func);
        }
      }
    }
    
    return resultado;
  }
  
  /**
   * Actualiza la fecha de una funcionalidad
   */
  actualizarFecha(funcId: string, nuevaFecha: string): boolean {
    const func = this.obtenerFuncionalidadPorId(funcId);
    if (func) {
      func.fecha = nuevaFecha;
      this.sistemaSubject.next(this.sistemaData);
      return true;
    }
    return false;
  }
  
  /**
   * Actualiza la situación de una funcionalidad
   */
  actualizarSituacion(funcId: string, nuevaSituacion: SituacionProyecto): boolean {
    const func = this.obtenerFuncionalidadPorId(funcId);
    if (func) {
      func.situacion = nuevaSituacion;
      // Resetear todos los marcadores primero
      func.dev = '-';
      func.qa = '-';
      func.pro = '-';
      // Actualizar marcadores según nueva situación
      switch (nuevaSituacion) {
        case 'EN_PROCESO':
          func.dev = 'X';
          break;
        case 'ACTUALIZADA':
          func.qa = 'X';
          break;
        case 'DEPRECADO':
          func.pro = 'X';
          break;
        case 'RECHAZADA':
          // Rechazada no tiene marcador específico
          break;
      }
      this.sistemaSubject.next(this.sistemaData);
      return true;
    }
    return false;
  }
  
  /**
   * Actualiza la fase de una funcionalidad
   */
  actualizarFase(funcId: string, nuevaFase: FaseProyecto): boolean {
    const func = this.obtenerFuncionalidadPorId(funcId);
    if (func) {
      func.fase = nuevaFase;
      this.sistemaSubject.next(this.sistemaData);
      return true;
    }
    return false;
  }
  
  /**
   * Cambia el estado de una funcionalidad (toggle DEV/QA/PRO)
   */
  cambiarEstadoPipeline(funcId: string, campo: 'dev' | 'qa' | 'pro'): boolean {
    const func = this.obtenerFuncionalidadPorId(funcId);
    if (func) {
      func[campo] = func[campo] === 'X' ? '-' : 'X';
      func.estado = func.dev === 'X' || func.qa === 'X' || func.pro === 'X';
      this.sistemaSubject.next(this.sistemaData);
      return true;
    }
    return false;
  }
  
  /**
   * Obtiene lista de App IDs disponibles
   */
  obtenerAppsDisponibles(): string[] {
    return this.sistemaData?.appsDisponibles || [];
  }
  
  /**
   * Obtiene nombres únicos de módulos
   */
  obtenerNombresModulos(): string[] {
    return this.sistemaData?.modulos.map(m => m.nombre) || [];
  }
  
  /**
   * Obtiene nombres únicos de submódulos para un módulo
   */
  obtenerNombresSubmodulos(moduloNombre: string): string[] {
    const modulo = this.sistemaData?.modulos.find(m => m.nombre === moduloNombre);
    return modulo?.submodulos.map(s => s.nombre) || [];
  }
  
  /**
   * Calcula estadísticas del sistema
   */
  calcularEstadisticas(): EstadisticasProyecto {
    if (!this.sistemaData) {
      return { total: 0, enDesarrollo: 0, enQA: 0, enProduccion: 0, porcentajeAvance: 0 };
    }
    
    let enDesarrollo = 0;
    let enQA = 0;
    let enProduccion = 0;
    
    for (const modulo of this.sistemaData.modulos) {
      for (const submodulo of modulo.submodulos) {
        for (const func of submodulo.funcionalidades) {
          if (func.situacion === 'EN_PROCESO') enDesarrollo++;
          else if (func.situacion === 'ACTUALIZADA') enQA++;
          else if (func.situacion === 'DEPRECADO') enProduccion++;
        }
      }
    }
    
    const total = this.sistemaData.totalFuncionalidades;
    const porcentajeAvance = total > 0 ? Math.round((enProduccion / total) * 100) : 0;
    
    return {
      total,
      enDesarrollo,
      enQA,
      enProduccion,
      porcentajeAvance
    };
  }
  
  /**
   * Exporta el sistema completo a JSON
   */
  exportarSistemaAJSON(): string {
    if (!this.sistemaData) return '{}';
    return JSON.stringify(this.sistemaData, null, 2);
  }
  
  /**
   * Descarga el JSON del sistema
   */
  descargarJSON(nombreArchivo: string = 'proyecto-sssifanb.json'): void {
    const jsonStr = this.exportarSistemaAJSON();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    URL.revokeObjectURL(url);
  }
}
