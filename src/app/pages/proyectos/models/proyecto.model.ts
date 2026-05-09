/**
 * Modelos TypeScript para Gestión de Proyectos - Freya SandraDC
 * Migración de Gantt a Freya con App ID mapping
 */

export type SituacionProyecto = 'EN_PROCESO' | 'DEPRECADO' | 'ACTUALIZADA' | 'RECHAZADA';
export type FaseProyecto = 'F.I' | 'F.II' | 'F.III';

/**
 * Representa una funcionalidad individual del sistema
 */
export interface FuncionalidadJSON {
  /** Identificador único: MODULO-SUBMODULO-### */
  id: string;
  
  /** App ID de Freya (ej: App.SDC) */
  appId: string;
  
  /** Nombre del módulo padre */
  modulo: string;
  
  /** Nombre del submódulo padre */
  submodulo: string;
  
  /** Campos existentes en el sistema */
  camposExistentes: string;
  
  /** Descripción de la funcionalidad */
  descripcion: string;
  
  /** Estado en desarrollo: 'X' o '-' */
  dev: string;
  
  /** Estado en QA: 'X' o '-' */
  qa: string;
  
  /** Estado en producción: 'X' o '-' */
  pro: string;
  
  /** Situación: EN_PROCESO, DEPRECADO, ACTUALIZADA, RECHAZADA */
  situacion: SituacionProyecto;
  
  /** Fase del proyecto */
  fase: FaseProyecto;
  
  /** Fecha de registro (YYYY-MM-DD) */
  fecha: string;

  /** Fecha de inicio del rango */
  fechaDesde?: string;

  /** Fecha de fin del rango */
  fechaHasta?: string;
  
  /** Estado activo: true si tiene 'X' en dev/qa/pro */
  estado: boolean;
  
  /** Observaciones adicionales */
  observaciones?: string;
}

/**
 * Representa un submódulo que agrupa funcionalidades
 */
export interface SubmoduloJSON {
  /** Nombre del submódulo */
  nombre: string;
  
  /** App ID asociado */
  appId: string;
  
  /** Cantidad de funcionalidades */
  totalFuncionalidades: number;
  
  /** Lista de funcionalidades */
  funcionalidades: FuncionalidadJSON[];
}

/**
 * Representa un módulo principal del sistema
 */
export interface ModuloJSON {
  /** Nombre del módulo */
  nombre: string;
  
  /** App ID asociado */
  appId: string;
  
  /** Cantidad de submódulos */
  totalSubmodulos: number;
  
  /** Cantidad total de funcionalidades en el módulo */
  totalFuncionalidades: number;
  
  /** Lista de submódulos */
  submodulos: SubmoduloJSON[];
}

/**
 * Estructura raíz del sistema de proyectos
 */
export interface SistemaProyectoJSON {
  /** Identificador del sistema */
  sistema: string;
  
  /** Fecha de generación del JSON (ISO 8601) */
  fechaGeneracion: string;
  
  /** Total de funcionalidades en el sistema */
  totalFuncionalidades: number;
  
  /** Lista de App IDs disponibles en Freya */
  appsDisponibles: string[];
  
  /** Lista de módulos del sistema */
  modulos: ModuloJSON[];
}

/**
 * Filtros para búsqueda de funcionalidades
 */
export interface FiltrosProyecto {
  /** Texto de búsqueda */
  busqueda: string;
  
  /** App ID seleccionada */
  appId: string | null;
  
  /** Módulo seleccionado */
  modulo: string | null;
  
  /** Submódulo seleccionado */
  submodulo: string | null;
  
  /** Situación: D, Q, P o 'all' */
  situacion: SituacionProyecto | 'all';
  
  /** Estados activos: dev, qa, pro */
  estados: {
    dev: boolean;
    qa: boolean;
    pro: boolean;
  };
}

/**
 * Estadísticas del sistema de proyectos
 */
export interface EstadisticasProyecto {
  /** Total de funcionalidades */
  total: number;
  
  /** En desarrollo */
  enDesarrollo: number;
  
  /** En QA */
  enQA: number;
  
  /** En producción */
  enProduccion: number;
  
  /** Porcentaje de avance general */
  porcentajeAvance: number;
}

/**
 * Vista actual del componente
 */
export type VistaProyecto = 'arbol' | 'tabla' | 'gantt';
