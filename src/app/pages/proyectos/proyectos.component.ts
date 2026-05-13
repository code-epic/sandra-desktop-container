/**
 * Componente SandraProject - Gestión de Proyectos
 * Freya SandraDC - Monitor Sidebar Integration
 * 
 * Integra el sistema Gantt migrado con el tema SandraDC
 */

import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProyectosService } from './models/proyectos.service';
import {
  SistemaProyectoJSON,
  ModuloJSON,
  SubmoduloJSON,
  FuncionalidadJSON,
  FiltrosProyecto,
  EstadisticasProyecto,
  VistaProyecto,
  SituacionProyecto
} from './models/proyecto.model';
import { DesktopAppsService, DesktopApp } from '../../core/services/desktop-apps.service';
import { AppStateService } from '../../core/services/app-state.service';
import { DomSanitizer } from '@angular/platform-browser';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { SecurityService } from '../../core/services/security.service';

interface MonitorSdcConfig {
  access: {
    jwtStorage: 'localStorage' | 'sessionStorage';
    jwtVariableName: string;
  };
}


@Component({
  selector: 'app-proyectos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './proyectos.component.html',
  styleUrls: ['./proyectos.component.css']
})
export class ProyectosComponent implements OnInit, OnDestroy {
  // Estado de carga
  cargando = false;
  error: string | null = null;

  // Datos del sistema
  sistema: SistemaProyectoJSON | null = null;
  modulos: ModuloJSON[] = [];
  funcionalidadesFiltradas: FuncionalidadJSON[] = [];
  estadisticas: EstadisticasProyecto = {
    total: 0,
    enDesarrollo: 0,
    enQA: 0,
    enProduccion: 0,
    porcentajeAvance: 0
  };

  // Apps instaladas
  appsInstaladas: DesktopApp[] = [];

  // Vista actual
  vistaActiva: VistaProyecto = 'arbol';

  // Filtros
  filtros: FiltrosProyecto = {
    busqueda: '',
    appId: null,
    modulo: null,
    submodulo: null,
    situacion: 'all',
    estados: {
      dev: false,
      qa: false,
      pro: false
    }
  };

  // Expansión de árbol
  modulosExpandidos: Set<string> = new Set();
  submodulosExpandidos: Set<string> = new Set();

  // Funcionalidad seleccionada (para detalles)
  funcionalidadSeleccionada: FuncionalidadJSON | null = null;

  // Gantt timeline data
  ganttMonths: string[] = [];
  ganttStartDate: Date = new Date();
  ganttEndDate: Date = new Date();

  // Calendar state
  calendarMonths: string[] = ['MAYO 2026', 'JUNIO 2026', 'JULIO 2026'];
  calendarMonthIdx: number = 0;
  calendarDays: number[] = Array.from({ length: 31 }, (_, i) => i + 1);
  calendarEmptyDays: number[] = [1, 2, 3, 4]; // Mayo
  calendarStartDay: number | null = 15;
  calendarEndDay: number | null = 21;
  calendarStartMonthIdx: number = 0;
  calendarEndMonthIdx: number = 0;
  isSliding: boolean = false;

  // Estado Modal Nueva Tarea
  mostrarModalNuevaTarea = false;
  nuevaTarea: any = {
    descripcion: '',
    modulo: '',
    submodulo: '',
    fase: 'F.I'
  };
  currentUserLogin: string = 'default';


  constructor(
    private proyectosService: ProyectosService,
    private appsService: DesktopAppsService,
    private appState: AppStateService,
    private sanitizer: DomSanitizer,
    private securityService: SecurityService
  ) { }

  async ngOnInit() {

    if (!this.checkAuth()) return;

    this.cargando = true;

    try {
      // Cargar apps instaladas
      await this.cargarAppsInstaladas();

      // Cargar datos del proyecto
      await this.cargarDatosProyecto();

      // Expandir primer módulo por defecto
      if (this.modulos.length > 0) {
        this.modulosExpandidos.add(this.modulos[0].nombre);
      }

      // Inicializar Gantt
      this.generarGanttTimeline();

    } catch (err) {
      this.error = 'Error al cargar los datos del proyecto';
      console.error(err);
    } finally {
      this.cargando = false;
    }
  }

  private checkAuth(): boolean {
    const configStr = localStorage.getItem('sdc_ui_config');
    const isRealJwt = (t: any) => t && t.length > 20 && t.includes('.');

    if (configStr) {
      try {
        const config: MonitorSdcConfig = JSON.parse(configStr);
        const storage = config.access.jwtStorage === 'sessionStorage' ? sessionStorage : localStorage;
        const token = storage.getItem(config.access.jwtVariableName);

        if (!isRealJwt(token)) {
          console.warn("Proyectos: Acceso denegado. Token no válido o sesión no activa.");
          this.appState.setActiveTab('dashboard');
          return false;
        }

        // Extraer usuario del JWT para filtrado de datos
        try {
          if (token) {
            const payload = JSON.parse(atob(token.split('.')[1]));
            this.currentUserLogin = payload.Usuario?.['usuario'] || payload.usuario || 'default';
          }
        } catch (e) {
          this.currentUserLogin = 'default';
        }
      } catch (e) {
        console.error("Error validando auth en Monitor", e);
        this.appState.setActiveTab('dashboard');
        return false;
      }
    } else {
      console.warn("Monitor: Configuración no encontrada.");
      this.appState.setActiveTab('dashboard');
      return false;
    }
    return true;
  }


  ngOnDestroy() { }

  /**
   * Obtiene las funcionalidades agrupadas por fase para la vista de tabla
   */
  get funcionalidadesAgrupadasPorFase(): { fase: string, funcionalidades: FuncionalidadJSON[] }[] {
    const fases = ['F.I', 'F.II', 'F.III', 'F.IV', 'F.V'];
    return fases.map(fase => ({
      fase,
      funcionalidades: this.funcionalidadesFiltradas.filter(func => func.fase === fase)
    })).filter(group => group.funcionalidades.length > 0);
  }

  /**
   * Carga las aplicaciones instaladas en Freya
   */
  private async cargarAppsInstaladas(): Promise<void> {
    try {
      this.appsInstaladas = await this.appsService.getAllApps();
    } catch (error) {
      console.warn('No se pudieron cargar las apps instaladas:', error);
      // Usar App.SDC como default
      this.appsInstaladas = [{
        app_id: 'App.SDC',
        name: 'Sandra Desktop Container',
        icon: 'fas fa-desktop',
        is_installed: true,
        is_favorite: false
      }];
    }
  }

  /**
   * Carga los datos del proyecto desde el JSON
   */
  private async cargarDatosProyecto(): Promise<void> {
    // El JSON está en assets/data/project.json (copiado desde man/gantt)
    await this.proyectosService.cargarDatos('assets/data/project.json');

    this.proyectosService.sistema$.subscribe(sistema => {
      this.sistema = sistema;
      this.modulos = sistema?.modulos || [];
      this.aplicarFiltros();
      this.calcularEstadisticas();
    });
  }

  /**
   * Cambia la vista activa
   */
  cambiarVista(vista: VistaProyecto): void {
    this.vistaActiva = vista;
  }

  /**
   * Aplica los filtros actuales
   */
  aplicarFiltros(): void {
    this.funcionalidadesFiltradas = this.proyectosService.filtrarFuncionalidades(this.filtros);
    this.calcularEstadisticas();
  }

  /**
   * Calcula estadísticas del proyecto
   */
  private calcularEstadisticas(): void {
    this.estadisticas = this.proyectosService.calcularEstadisticas();
  }

  /**
   * Expande o colapsa un módulo
   */
  toggleModulo(nombreModulo: string): void {
    if (this.modulosExpandidos.has(nombreModulo)) {
      this.modulosExpandidos.delete(nombreModulo);
    } else {
      this.modulosExpandidos.add(nombreModulo);
    }
  }

  /**
   * Expande o colapsa un submódulo
   */
  toggleSubmodulo(moduloNombre: string, submoduloNombre: string): void {
    const key = `${moduloNombre}-${submoduloNombre}`;
    if (this.submodulosExpandidos.has(key)) {
      this.submodulosExpandidos.delete(key);
    } else {
      this.submodulosExpandidos.add(key);
    }
  }

  /**
   * Verifica si un módulo está expandido
   */
  isModuloExpandido(nombreModulo: string): boolean {
    return this.modulosExpandidos.has(nombreModulo);
  }

  /**
   * Verifica si un submódulo está expandido
   */
  isSubmoduloExpandido(moduloNombre: string, submoduloNombre: string): boolean {
    return this.submodulosExpandidos.has(`${moduloNombre}-${submoduloNombre}`);
  }

  /**
   * Cambia la fecha de una funcionalidad
   */
  cambiarFecha(funcId: string, nuevaFecha: string): void {
    const exito = this.proyectosService.actualizarFecha(funcId, nuevaFecha);
    if (exito) {
      this.aplicarFiltros();
    }
  }

  /**
   * Cambia la situación de una funcionalidad
   */
  cambiarSituacion(funcId: string, nuevaSituacion: SituacionProyecto): void {
    const exito = this.proyectosService.actualizarSituacion(funcId, nuevaSituacion);
    if (exito) {
      this.aplicarFiltros();
    }
  }

  /**
   * Cambia el estado del pipeline (toggle D/Q/P) con lógica condicional
   */
  toggleEstadoPipeline(funcId: string, campo: 'dev' | 'qa' | 'pro'): void {
    const func = this.funcionalidadesFiltradas.find(f => f.id === funcId);
    if (!func) return;

    if (campo === 'pro') {
      // Solo permite activar PRO si QA ya está en 'X'
      if (func.pro === 'X') {
        func.pro = '-';
      } else if (func.qa === 'X') {
        func.pro = 'X';
      }
    } else if (campo === 'qa') {
      // Solo permite activar QA si DEV ya está en 'X'
      if (func.qa === 'X') {
        func.qa = '-';
        func.pro = '-'; // Si quito QA, pierdo PRO por lógica de flujo
      } else if (func.dev === 'X') {
        func.qa = 'X';
      }
    } else if (campo === 'dev') {
      if (func.dev === 'X') {
        func.dev = '-';
        func.qa = '-';
        func.pro = '-';
      } else {
        func.dev = 'X';
      }
    }

    // Persistir estado y notificar
    func.estado = func.dev === 'X' || func.qa === 'X' || func.pro === 'X';
    this.proyectosService.notificarCambios();
    this.aplicarFiltros();
  }

  /**
   * Cambia la fase de una funcionalidad (I, II, III, IV, V)
   */
  cambiarFase(funcId: string, fase: string): void {
    const func = this.funcionalidadesFiltradas.find(f => f.id === funcId);
    if (func) {
      func.fase = fase as any;
      this.proyectosService.notificarCambios();
    }
  }

  /**
   * Actualiza las observaciones de una funcionalidad
   */
  actualizarObservaciones(funcId: string, texto: string): void {
    const func = this.funcionalidadesFiltradas.find(f => f.id === funcId);
    if (func) {
      func.observaciones = texto;
      // Disparamos actualización en el servicio si fuera necesario, 
      // pero como es por referencia en el array filtrado ya está
    }
  }

  /**
   * Selecciona un día en el calendario (lógica de rango entre meses)
   */
  seleccionarDiaCal(dia: number): void {
    const currentMonthIdx = this.calendarMonthIdx;

    if (!this.calendarStartDay || (this.calendarStartDay && this.calendarEndDay)) {
      this.calendarStartDay = dia;
      this.calendarStartMonthIdx = currentMonthIdx;
      this.calendarEndDay = null;
      this.calendarEndMonthIdx = -1;
    } else {
      // Comparar fechas para determinar orden
      const startTotal = this.calendarStartMonthIdx * 31 + (this.calendarStartDay || 0);
      const currentTotal = currentMonthIdx * 31 + dia;

      if (currentTotal < startTotal) {
        this.calendarEndDay = this.calendarStartDay;
        this.calendarEndMonthIdx = this.calendarStartMonthIdx;
        this.calendarStartDay = dia;
        this.calendarStartMonthIdx = currentMonthIdx;
      } else {
        this.calendarEndDay = dia;
        this.calendarEndMonthIdx = currentMonthIdx;
      }
    }

    // Actualizar la funcionalidad seleccionada si existe
    if (this.funcionalidadSeleccionada) {
      const startMes = this.calendarMonths[this.calendarStartMonthIdx].split(' ')[0].substring(0, 3);
      this.funcionalidadSeleccionada.fechaDesde = `${this.calendarStartDay} ${startMes}`;

      if (this.calendarEndDay) {
        const endMes = this.calendarMonths[this.calendarEndMonthIdx].split(' ')[0].substring(0, 3);
        this.funcionalidadSeleccionada.fechaHasta = `${this.calendarEndDay} ${endMes}`;
      } else {
        this.funcionalidadSeleccionada.fechaHasta = '';
      }

      this.proyectosService.notificarCambios();
    }
  }

  /**
   * Verifica si un día está en el rango seleccionado (soporta múltiples meses)
   */
  isDayInRange(dia: number, monthIdx: number): boolean {
    if (!this.calendarStartDay || !this.calendarEndDay) return false;

    const startTotal = this.calendarStartMonthIdx * 32 + (this.calendarStartDay || 0);
    const endTotal = this.calendarEndMonthIdx * 32 + (this.calendarEndDay || 0);
    const currentTotal = monthIdx * 32 + dia;

    return currentTotal > startTotal && currentTotal < endTotal;
  }

  /**
   * Cambia el mes del calendario
   */
  cambiarMesCal(delta: number): void {
    const nextIdx = this.calendarMonthIdx + delta;
    if (nextIdx >= 0 && nextIdx < this.calendarMonths.length) {
      this.isSliding = true;
      setTimeout(() => {
        this.calendarMonthIdx = nextIdx;
        // Ajustar días según el mes (Simplificado)
        if (this.calendarMonthIdx === 0) { // Mayo
          this.calendarDays = Array.from({ length: 31 }, (_, i) => i + 1);
          this.calendarEmptyDays = [1, 2, 3, 4];
        } else if (this.calendarMonthIdx === 1) { // Junio
          this.calendarDays = Array.from({ length: 30 }, (_, i) => i + 1);
          this.calendarEmptyDays = [0]; // Empieza lunes
        }
        this.isSliding = false;
      }, 300);
    }
  }

  /**
   * Listener para cerrar con tecla ESC
   */
  @HostListener('window:keydown.escape')
  onKeydownHandler() {
    if (this.funcionalidadSeleccionada) {
      this.cerrarDetalles();
    }
  }

  /**
   * Selecciona una funcionalidad para ver detalles
   */
  seleccionarFuncionalidad(func: FuncionalidadJSON): void {
    this.funcionalidadSeleccionada = func;

    // Cargar fechas existentes en el calendario para el mockup/interacción
    if (func.fechaDesde) {
      const parts = func.fechaDesde.split(' ');
      const day = parseInt(parts[0]);
      if (!isNaN(day)) this.calendarStartDay = day;

      // Encontrar índice del mes
      const mesNombre = parts[1]?.toUpperCase();
      const idx = this.calendarMonths.findIndex(m => m.startsWith(mesNombre));
      if (idx !== -1) this.calendarStartMonthIdx = idx;
    } else {
      this.calendarStartDay = 15;
      this.calendarStartMonthIdx = 0;
    }

    if (func.fechaHasta) {
      const parts = func.fechaHasta.split(' ');
      const day = parseInt(parts[0]);
      if (!isNaN(day)) this.calendarEndDay = day;

      const mesNombre = parts[1]?.toUpperCase();
      const idx = this.calendarMonths.findIndex(m => m.startsWith(mesNombre));
      if (idx !== -1) this.calendarEndMonthIdx = idx;
    } else {
      this.calendarEndDay = 21;
      this.calendarEndMonthIdx = 0;
    }
  }

  /**
   * Cierra el panel de detalles
   */
  cerrarDetalles(): void {
    this.funcionalidadSeleccionada = null;
  }

  /**
   * Exporta el sistema a JSON
   */
  exportarJSON(): void {
    this.proyectosService.descargarJSON('proyecto-sssifanb.json');
  }

  /**
   * Obtiene el color de badge según situación
   */
  getBadgeColor(situacion: SituacionProyecto): string {
    switch (situacion) {
      case 'EN_PROCESO': return 'en-proceso';
      case 'DEPRECADO': return 'deprecado';
      case 'ACTUALIZADA': return 'actualizada';
      case 'RECHAZADA': return 'rechazada';
      default: return 'default';
    }
  }

  /**
   * Obtiene el texto de situación
   */
  getSituacionTexto(situacion: SituacionProyecto): string {
    switch (situacion) {
      case 'EN_PROCESO': return 'En Proceso';
      case 'DEPRECADO': return 'Deprecado';
      case 'ACTUALIZADA': return 'Actualizada';
      case 'RECHAZADA': return 'Rechazada';
      default: return 'En Proceso';
    }
  }

  /**
   * Limpia todos los filtros
   */
  limpiarFiltros(): void {
    this.filtros = {
      busqueda: '',
      appId: null,
      modulo: null,
      submodulo: null,
      situacion: 'all',
      estados: {
        dev: false,
        qa: false,
        pro: false
      }
    };
    this.aplicarFiltros();
  }

  /**
   * Verifica si hay filtros activos
   */
  hayFiltrosActivos(): boolean {
    return this.filtros.busqueda !== '' ||
      this.filtros.appId !== null ||
      this.filtros.modulo !== null ||
      this.filtros.submodulo !== null ||
      this.filtros.situacion !== 'all' ||
      this.filtros.estados.dev ||
      this.filtros.estados.qa ||
      this.filtros.estados.pro;
  }

  /**
   * Imprime el reporte actual
   */
  /**
   * Generar PDF con jsPDF y jspdf-autotable, luego enviar al Visor Seguro
   */
  imprimirReporte(): void {
    const datosFiltrados = this.funcionalidadesFiltradas;

    if (datosFiltrados.length === 0) {
      alert('❌ No hay datos para generar reporte');
      return;
    }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;

    // Titulo Principal - Verde Suave (Sandra Theme)
    doc.setFontSize(22);
    doc.setTextColor(76, 175, 80); // Green 500
    doc.setFont('helvetica', 'bold');
    doc.text('REPORTE DE FUNCIONALIDADES', pageWidth / 2, 20, { align: 'center' });

    // Subtítulo
    doc.setFontSize(14);
    doc.setTextColor(97, 97, 97); // Grey 700
    doc.text('SSSIFANB - Sistema de Gestión de Proyectos', pageWidth / 2, 28, { align: 'center' });

    // Línea Decorativa Sutil
    doc.setDrawColor(224, 224, 224); // Grey 300
    doc.setLineWidth(0.5);
    doc.line(14, 32, pageWidth - 14, 32);

    // Resumen estadístico
    const total = datosFiltrados.length;
    const proCount = datosFiltrados.filter(i => i.pro === 'X').length;
    const proPct = Math.round((proCount / total) * 100) || 0;

    doc.setFontSize(10);
    doc.setTextColor(117, 117, 117);
    doc.setFont('helvetica', 'normal');
    doc.text(`Total de Funcionalidades: ${total} | Avance en Producción: ${proPct}%`, pageWidth / 2, 40, { align: 'center' });
    doc.text(`Generado el: ${new Date().toLocaleString()}`, pageWidth / 2, 45, { align: 'center' });

    // Procesar Datos Jerárquicos
    const tableData: any[][] = [];
    const rowConfig: any[] = [];
    let lastModule = '';
    let lastSubmodulo = '';

    // Ordenar para agrupar correctamente
    const sortedData = [...datosFiltrados].sort((a, b) => {
      if (a.modulo !== b.modulo) return a.modulo.localeCompare(b.modulo);
      if (a.submodulo !== b.submodulo) return a.submodulo.localeCompare(b.submodulo);
      return a.descripcion.localeCompare(b.descripcion);
    });

    sortedData.forEach(func => {
      const isNewModule = func.modulo !== lastModule;
      if (isNewModule) {
        lastModule = func.modulo;
        lastSubmodulo = '';
        tableData.push([
          `MÓDULO: ${func.modulo.toUpperCase()}`,
          ''
        ]);
        rowConfig.push({ type: 'module' });
      }

      const isNewSubmodulo = func.submodulo !== lastSubmodulo;
      if (isNewSubmodulo) {
        lastSubmodulo = func.submodulo;
        tableData.push([
          `   SUBMÓDULO: ${func.submodulo.toUpperCase()}`,
          ''
        ]);
        rowConfig.push({ type: 'menu_header' });
      }

      tableData.push([
        `      ${func.descripcion}`,
        { dev: func.dev === 'X', qa: func.qa === 'X', pro: func.pro === 'X' }
      ]);
      rowConfig.push({ type: 'privilege' });
    });

    autoTable(doc, {
      startY: 55,
      head: [['FUNCIONALIDAD', 'ESTADOS (D/Q/P)']],
      body: tableData,
      theme: 'grid',

      styles: {
        font: 'helvetica',
        fontSize: 9,
        cellPadding: 3,
        valign: 'middle',
        lineColor: [238, 238, 238],
        lineWidth: 0.1,
        textColor: [97, 97, 97]
      },

      headStyles: {
        fillColor: [255, 255, 255],
        textColor: [76, 175, 80], // Green 500
        fontStyle: 'bold',
        halign: 'left',
        lineWidth: 0,
        lineColor: [255, 255, 255]
      },

      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 35, halign: 'center' }
      },

      didParseCell: (data) => {
        const rowIndex = data.row.index;
        const config = rowConfig[rowIndex];

        if (data.section === 'body') {
          if (config && config.type === 'module') {
            data.cell.styles.fillColor = [232, 245, 233]; // Green 50
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.textColor = [46, 125, 50]; // Green 800
            if (data.column.index === 0) data.cell.colSpan = 2;
          }

          if (config && config.type === 'menu_header') {
            data.cell.styles.fillColor = [250, 250, 250]; // Grey 50
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.textColor = [66, 66, 66];
            if (data.column.index === 0) data.cell.colSpan = 2;
          }

          if (config && config.type === 'privilege') {
            data.cell.styles.fillColor = [255, 255, 255];
          }

          // Vaciar texto en columna de estado si no es privilegio
          if (data.column.index === 1) {
            data.cell.text = [];
          }
        }
      },

      didDrawCell: (data) => {
        if (data.section === 'body' && data.column.index === 1) {
          const rowIndex = data.row.index;
          const config = rowConfig[rowIndex];

          if (config && config.type === 'privilege') {
            const estados = data.cell.raw as any;
            const dim = 5;
            const spacing = 8;

            // Centrar horizontalmente los 3 rectangulitos
            const startX = data.cell.x + (data.cell.width / 2) - ((dim * 3 + spacing * 2) / 2) + 2;
            const cy = data.cell.y + (data.cell.height / 2) - (dim / 2);

            // DEV
            if (estados.dev) {
              doc.setFillColor(76, 175, 80); // Green
              doc.roundedRect(startX, cy, dim, dim, 1, 1, 'FD');
            } else {
              doc.setDrawColor(224, 224, 224);
              doc.setFillColor(250, 250, 250);
              doc.roundedRect(startX, cy, dim, dim, 1, 1, 'FD');
            }

            // QA
            if (estados.qa) {
              doc.setFillColor(255, 152, 0); // Orange
              doc.roundedRect(startX + spacing, cy, dim, dim, 1, 1, 'FD');
            } else {
              doc.setDrawColor(224, 224, 224);
              doc.setFillColor(250, 250, 250);
              doc.roundedRect(startX + spacing, cy, dim, dim, 1, 1, 'FD');
            }

            // PRO
            if (estados.pro) {
              doc.setFillColor(16, 185, 129); // Emerald
              doc.roundedRect(startX + spacing * 2, cy, dim, dim, 1, 1, 'FD');
              // Checkmark
              doc.setDrawColor(255, 255, 255);
              doc.setLineWidth(0.6);
              doc.line(startX + spacing * 2 + 1, cy + 2.5, startX + spacing * 2 + 2, cy + 3.5);
              doc.line(startX + spacing * 2 + 2, cy + 3.5, startX + spacing * 2 + 4, cy + 1.5);
            } else {
              doc.setDrawColor(224, 224, 224);
              doc.setFillColor(250, 250, 250);
              doc.roundedRect(startX + spacing * 2, cy, dim, dim, 1, 1, 'FD');
            }
          }
        }
      }
    });

    // Bloque de Resumen Final (Totalizador)
    const finalY = (doc as any).lastAutoTable.finalY + 15;

    // Si no hay suficiente espacio para el totalizador, agregar una página
    if (finalY + 40 > pageHeight - 20) {
      doc.addPage();
    }

    const currentY = (doc as any).lastAutoTable.finalY + 15 > pageHeight - 60 ? 20 : finalY;

    doc.setFillColor(245, 245, 245); // Light grey background
    doc.setDrawColor(224, 224, 224);
    doc.roundedRect(14, currentY, pageWidth - 28, 35, 3, 3, 'FD');

    doc.setFontSize(12);
    doc.setTextColor(46, 125, 50); // Green 800
    doc.setFont('helvetica', 'bold');
    doc.text('RESUMEN DEL PROYECTO', pageWidth / 2, currentY + 10, { align: 'center' });

    const devCount = datosFiltrados.filter(i => i.dev === 'X').length;
    const qaCount = datosFiltrados.filter(i => i.qa === 'X').length;

    const colWidth = (pageWidth - 28) / 4;

    doc.setFontSize(9);
    doc.setTextColor(117, 117, 117);
    doc.setFont('helvetica', 'normal');

    // Labels
    doc.text(`Total Funciones`, 14 + colWidth / 2, currentY + 20, { align: 'center' });
    doc.text(`En Desarrollo`, 14 + colWidth + colWidth / 2, currentY + 20, { align: 'center' });
    doc.text(`En QA`, 14 + colWidth * 2 + colWidth / 2, currentY + 20, { align: 'center' });
    doc.text(`En Producción`, 14 + colWidth * 3 + colWidth / 2, currentY + 20, { align: 'center' });

    // Values
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(33, 33, 33);
    doc.text(`${total}`, 14 + colWidth / 2, currentY + 28, { align: 'center' });

    doc.setTextColor(76, 175, 80); // Green for Dev
    doc.text(`${Math.round((devCount / total) * 100) || 0}%`, 14 + colWidth + colWidth / 2, currentY + 28, { align: 'center' });

    doc.setTextColor(255, 152, 0); // Orange for QA
    doc.text(`${Math.round((qaCount / total) * 100) || 0}%`, 14 + colWidth * 2 + colWidth / 2, currentY + 28, { align: 'center' });

    doc.setTextColor(16, 185, 129); // Emerald for PRO
    doc.text(`${proPct}%`, 14 + colWidth * 3 + colWidth / 2, currentY + 28, { align: 'center' });

    // Paginación Minimalist
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(200);
      doc.text(`${i} / ${pageCount}`, pageWidth - 14, pageHeight - 10, { align: 'right' });
    }

    const fileName = `Reporte_Proyectos_${new Date().getTime()}.pdf`;

    // Convert to Blob and open in Visor Seguro
    const pdfBlob = doc.output('blob');
    const url = URL.createObjectURL(pdfBlob);
    const safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);

    // Convert to base64 for data URI (Visor Seguro might need it)
    const reader = new FileReader();
    reader.readAsDataURL(pdfBlob);
    reader.onloadend = () => {
      const base64data = reader.result as string;

      this.appState.addTab({
        id: 'doc-reporte-' + Date.now(),
        name: fileName,
        icon: 'fas fa-file-pdf',
        type: 'pdf-viewer',
        content: safeUrl,
        url: safeUrl,
        blobData: base64data,
        originalName: fileName,
        filePath: '',
        isProtected: false,
        isSavedToHistory: false,
        showToolbar: true,
        zoomLevel: 1.0,
        mimeType: 'application/pdf',
        csvHeader: [],
        csvRows: []
      });
    };
  }

  /**
   * Abre el modal para crear una nueva tarea
   */
  abrirModalNuevaTarea(): void {
    this.nuevaTarea = {
      descripcion: '',
      modulo: this.modulos[0]?.nombre || '',
      submodulo: '',
      fase: 'F.I'
    };
    this.onModuloChange();
    this.mostrarModalNuevaTarea = true;
  }

  /**
   * Cierra el modal de nueva tarea
   */
  cerrarModalNuevaTarea(): void {
    this.mostrarModalNuevaTarea = false;
  }

  /**
   * Obtiene los submódulos de un módulo específico
   */
  getSubmodulos(moduloNombre: string): SubmoduloJSON[] {
    return this.proyectosService.obtenerSubmodulos(moduloNombre);
  }

  /**
   * Maneja el cambio de módulo para resetear el submódulo
   */
  onModuloChange(): void {
    const submodulos = this.getSubmodulos(this.nuevaTarea.modulo);
    this.nuevaTarea.submodulo = submodulos[0]?.nombre || '';
  }

  /**
   * Guarda la nueva tarea
   */
  guardarNuevaTarea(): void {
    if (!this.nuevaTarea.descripcion || !this.nuevaTarea.modulo || !this.nuevaTarea.submodulo) {
      alert('Por favor complete todos los campos requeridos');
      return;
    }

    const exito = this.proyectosService.agregarFuncionalidad(this.nuevaTarea);
    if (exito) {
      this.cerrarModalNuevaTarea();
      this.aplicarFiltros();
    } else {
      alert('Error al agregar la tarea. Verifique los datos.');
    }
  }

  // ===== GANTT TIMELINE METHODS =====

  /**
   * Genera los meses para el timeline del Gantt
   */
  generarGanttTimeline(): void {
    const months: string[] = [];
    const today = new Date();
    const startOfYear = new Date(today.getFullYear(), 0, 1);
    const endOfYear = new Date(today.getFullYear(), 11, 31);

    this.ganttStartDate = startOfYear;
    this.ganttEndDate = endOfYear;

    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    for (let i = 0; i < 12; i++) {
      months.push(`${monthNames[i]} ${today.getFullYear()}`);
    }

    this.ganttMonths = months;
  }

  /**
   * Calcula la posición left de la barra en el Gantt basado en fechaDesde
   */
  getGanttBarPosition(func: FuncionalidadJSON): { left: number } {
    if (!func.fechaDesde) return { left: 5 };

    // Parsear día y mes (ej: "15 May")
    const day = parseInt(func.fechaDesde.split(' ')[0]);
    // Simplificación para el demo: mapear a un porcentaje de 0-100 del mes actual
    const left = ((day - 1) / 31) * 100;
    return { left: Math.max(0, Math.min(92, left)) };
  }

  /**
   * Calcula el ancho de la barra en el Gantt basado en el rango
   */
  getGanttBarWidth(func: FuncionalidadJSON): number {
    if (!func.fechaDesde || !func.fechaHasta) return 8;

    const start = parseInt(func.fechaDesde.split(' ')[0]);
    const end = parseInt(func.fechaHasta.split(' ')[0]);

    if (isNaN(start) || isNaN(end)) return 8;

    let duration = end - start;
    if (duration < 0) duration = 5; // Fallback
    if (duration === 0) duration = 1;

    const width = (duration / 31) * 100;
    return Math.max(4, Math.min(100, width));
  }
}
