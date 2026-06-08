import { Injectable } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { AppStateService } from './app-state.service';
import { UtilsService } from './utils.service';
import { ISandraJwtPayload } from '../models/security.model';

@Injectable({
  providedIn: 'root'
})
export class CaucionService {

  constructor(
    private appState: AppStateService,
    private utils: UtilsService,
    private sanitizer: DomSanitizer
  ) {}

  generarCaucionPdf(token: string): void {
    if (!token) {
      console.error('No se proporcionó token para generar la caución');
      return;
    }

    const payload: ISandraJwtPayload = this.utils.decodeJwt(token);
    
    if (!payload || !payload.Usuario) {
      console.error('Payload de JWT inválido o sin información de Usuario');
      return;
    }

    const usr = payload.Usuario;
    const firma = usr.FirmaDigital;

    const doc = new jsPDF('p', 'mm', 'legal');
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;

    // Colores institucionales
    const titleColor: [number, number, number] = [0, 0, 0]; // Negro para formalidad
    const textColor: [number, number, number] = [0, 0, 0];
    const lightText: [number, number, number] = [80, 80, 80];

    // --- ENCABEZADO OFICIAL ---
    doc.setFontSize(9);
    doc.setTextColor(...textColor);
    doc.setFont('helvetica', 'bold');
    doc.text('REPÚBLICA BOLIVARIANA DE VENEZUELA', pageWidth / 2, 12, { align: 'center' });
    doc.text('MINISTERIO DEL PODER POPULAR PARA LA DEFENSA', pageWidth / 2, 16, { align: 'center' });
    doc.text('FUERZA ARMADA NACIONAL BOLIVARIANA', pageWidth / 2, 20, { align: 'center' });
    doc.text('DIRECCIÓN GENERAL DE TECNOLOGÍAS DE LA INFORMACIÓN Y COMUNICACIONES', pageWidth / 2, 24, { align: 'center' });

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.4);
    doc.line(20, 27, pageWidth - 20, 27);

    // --- TÍTULO DEL DOCUMENTO ---
    doc.setFontSize(11);
    doc.text('CAUCIÓN DE RESPONSABILIDAD Y CONFIDENCIALIDAD', pageWidth / 2, 34, { align: 'center' });
    doc.text('EN MATERIA DE SEGURIDAD INFORMÁTICA', pageWidth / 2, 39, { align: 'center' });

    // --- SECCIÓN I: IDENTIFICACIÓN ---
    doc.setFontSize(9.5);
    doc.text('I. IDENTIFICACIÓN DEL OTORGANTE', 20, 48);

    // Tabla de Identificación (Bordes definidos)
    autoTable(doc, {
      startY: 51,
      margin: { left: 20, right: 20 },
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 8.5,
        textColor: [0, 0, 0],
        lineColor: [0, 0, 0],
        lineWidth: 0.15,
        cellPadding: 2.5
      },
      body: [
        [
          { content: 'Nombres y Apellidos:\n' + (usr.nombre || 'N/A'), colSpan: 2 },
          { content: 'Cédula de Identidad:\n' + (usr.cedula || 'N/A') }
        ],
        [
          { content: 'Grado / Jerarquía:\n' + (usr.cargo || usr.Perfil?.descripcion || 'N/A') },
          { content: 'Plaza / Unidad / Sistema:\n' + (usr.sistema || 'N/A') },
          { content: 'Nombre de Usuario:\n' + (usr.usuario || 'N/A') }
        ]
      ]
    });

    const finalY1 = (doc as any).lastAutoTable.finalY;

    // --- SECCIÓN II: DECLARACIÓN JURADA ---
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('II. DECLARACIÓN JURADA Y OBJETO DE LA CAUCIÓN', 20, finalY1 + 5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const textoObjeto = 'Quien suscribe, militar o civil debidamente identificado en la sección precedente, adscrito a la Fuerza Armada Nacional Bolivariana (FANB), declaro bajo fe de juramento y en pleno ejercicio de mis facultades cognitivas, que he sido instruido y poseo pleno conocimiento de las políticas, normas, directrices y protocolos de ciberseguridad que rigen los sistemas de información, redes de datos e infraestructura de telecomunicaciones de esta institución militar. Por consiguiente, asumo formal e irrevocablemente la responsabilidad personal, civil, administrativa, disciplinaria y penal por el uso de las credenciales de acceso asignadas para operar el Sistema de Gestión y Acceso (SANDRA), obligándome a velar por la integridad, confidencialidad y disponibilidad de la información clasificada.';
    
    doc.text(textoObjeto, 20, finalY1 + 9, { align: 'justify', maxWidth: pageWidth - 40 });
    const linesObjeto = doc.splitTextToSize(textoObjeto, pageWidth - 40);
    const ySeccion3 = finalY1 + 9 + (linesObjeto.length * 4.2) + 4;

    // --- SECCIÓN III: BASAMENTO Y MARCO LEGAL ---
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('III. FUNDAMENTO Y MARCO LEGAL VENEZOLANO', 20, ySeccion3);

    let currentY = ySeccion3 + 5;
    const marcoLegal = [
      { title: '1. Constitución de la República Bolivariana de Venezuela (CRBV):', text: 'De conformidad con los artículos 322 y 326, la seguridad de la Nación es competencia de corresponsabilidad del Estado y la sociedad. Conforme al artículo 328, la FANB resguarda los secretos de Estado y militares.' },
      { title: '2. Ley Constitucional de la Fuerza Armada Nacional Bolivariana:', text: 'Establece la obligatoriedad de disciplina y resguardo absoluto de la información clasificada, redes de comunicaciones y sistemas del sector defensa.' },
      { title: '3. Código Orgánico de Justicia Militar (COJM):', text: 'El artículo 471 sanciona penalmente como delito militar la revelación de secretos de Estado, contraseñas o datos que afecten la seguridad de la FANB.' },
      { title: '4. Ley Especial Contra los Delitos Informáticos (G.O. N° 37.313):', text: 'Establece penas corporales y multas para el acceso indebido (Art. 6), sabotaje (Art. 7), espionaje informático (Art. 11) y revelación de datos confidenciales (Art. 22).' },
      { title: '5. Ley de Infogobierno (G.O. N° 40.274):', text: 'Regula el uso soberano y seguro de las tecnologías, ordenando salvaguardar la integridad de la información institucional pública y restringida.' }
    ];

    marcoLegal.forEach(item => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.text(item.title, 20, currentY);
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.text(item.text, 25, currentY + 4, { align: 'justify', maxWidth: pageWidth - 45 });
      const lines = doc.splitTextToSize(item.text, pageWidth - 45);
      currentY += 4 + (lines.length * 4.2) + 2;
    });

    const ySeccion4 = currentY + 2;

    // --- SECCIÓN IV: PROHIBICIONES EXPRESAS ---
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('IV. PROHIBICIONES EXPRESAS DE SEGURIDAD', 20, ySeccion4);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text('Queda terminantemente prohibido al firmante ejecutar las siguientes conductas, consideradas de alta gravedad:', 20, ySeccion4 + 5);

    const prohibiciones = [
      'a) Compartir, transferir, divulgar o descuidar las credenciales personales de acceso (usuarios, claves o tokens).',
      'b) Instalar o ejecutar software, utilitarios, scripts o programas no autorizados por la Dirección de Tecnología.',
      'c) Extraer, alterar, duplicar, transmitir o fugar información institucional clasificada o sensible hacia soportes o redes externas.',
      'd) Intentar eludir, evadir o realizar bypass sobre los firewalls, proxies, logs de auditoría o cualquier control de seguridad.',
      'e) Colaborar o ser partícipe en campañas de ingeniería social interna, phishing o suministro de información a terceros no autorizados.'
    ];

    let currentY2 = ySeccion4 + 9;
    prohibiciones.forEach(p => {
      doc.text(p, 25, currentY2, { align: 'justify', maxWidth: pageWidth - 45 });
      const lines = doc.splitTextToSize(p, pageWidth - 45);
      currentY2 += (lines.length * 4.2) + 1.5;
    });

    const ySeccion5 = currentY2 + 2;

    // --- SECCIÓN V: RÉGIMEN SANCIONATORIO ---
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('V. RÉGIMEN DE SANCIONES Y CONSECUENCIAS', 20, ySeccion5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text('El incumplimiento, negligencia o dolo acarreará de forma concurrente las siguientes responsabilidades:', 20, ySeccion5 + 5);

    const sanciones = [
      '1. Administrativas / Disciplinarias: Apertura de investigación administrativa, suspensión del cargo, retiro o baja forzosa para el personal militar, y destitución conforme a la Ley del Estatuto de la Función Pública para el personal civil.',
      '2. Penales Militares: Enjuiciamiento penal ante la Jurisdicción Penal Militar de la República Bolivariana de Venezuela, de conformidad con lo establecido en el Código Orgánico de Justicia Militar.',
      '3. Penales Ordinarias: Remisión inmediata de las actuaciones al Ministerio Público para su persecución penal conforme a la Ley Especial Contra los Delitos Informáticos y el Código Penal.'
    ];

    let currentY3 = ySeccion5 + 9;
    sanciones.forEach(s => {
      doc.text(s, 25, currentY3, { align: 'justify', maxWidth: pageWidth - 45 });
      const lines = doc.splitTextToSize(s, pageWidth - 45);
      currentY3 += (lines.length * 4.2) + 2;
    });

    const ySeccion6 = currentY3 + 2;

    // --- SECCIÓN VI: AUDITORÍA Y TRAZA ---
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('VI. CERTIFICACIÓN DE FIRMA DIGITAL Y TRAZA DE AUDITORÍA', 20, ySeccion6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...lightText);

    if (firma) {
      doc.text(`Dirección MAC Autorizada: ${firma.direccionmac || 'N/A'}`, 25, ySeccion6 + 5);
      doc.text(`Timestamp de Emisión: ${firma.tiempo || 'N/A'}`, 25, ySeccion6 + 9);
      doc.text(`ID de Sesión (SID): ${payload.sid || 'N/A'}`, 25, ySeccion6 + 13);
      doc.text(`Nivel de Seguridad: ${firma.nivel || 'Resguardado/Militar'}`, 25, ySeccion6 + 17);
    } else {
      doc.text('No se detectaron firmas criptográficas en la sesión actual.', 25, ySeccion6 + 5);
    }

    doc.setTextColor(0, 0, 0);

    // --- CAJETÍN DE FIRMA ACEPTACIÓN ---
    autoTable(doc, {
      startY: ySeccion6 + 22,
      margin: { left: 20, right: 20 },
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 8,
        textColor: [0, 0, 0],
        lineColor: [0, 0, 0],
        lineWidth: 0.15,
        halign: 'center',
        valign: 'middle'
      },
      body: [
        [
          { content: '\n\n___________________________________\nFirma del Obligado / Otorgante\nC.I. N°: ' + (usr.cedula || 'N/A'), styles: { minCellHeight: 25 } },
          { content: '\n\n[ HUELLA DACTILAR ]\n(Pulgar Derecho)', styles: { minCellHeight: 25, cellWidth: 32 } },
          { content: '\n\n___________________________________\nFirma y Sello de la Autoridad Competente\nDirección General de Tecnologías', styles: { minCellHeight: 25 } }
        ]
      ]
    });

    const finalY_Sign = (doc as any).lastAutoTable.finalY;
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...lightText);
    doc.text('Este documento tiene carácter de Declaración Jurada Oficial. Generado criptográficamente por el Sistema SANDRA.', pageWidth / 2, finalY_Sign + 6, { align: 'center' });
    doc.text(`Fecha y Hora de Certificación del Sistema: ${new Date().toLocaleString('es-VE')}`, pageWidth / 2, finalY_Sign + 10, { align: 'center' });
    
    // Convert to Blob and open in Visor Seguro
    const fileName = `Caucion_Seguridad_${usr.usuario}_${new Date().getTime()}.pdf`;
    const pdfBlob = doc.output('blob');
    // Añadir #zoom=FitH para asegurar que el visor nativo lo abra en un tamaño de lectura cómodo
    const url = URL.createObjectURL(pdfBlob) + '#zoom=FitH';
    const safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);

    const reader = new FileReader();
    reader.readAsDataURL(pdfBlob);
    reader.onloadend = () => {
      const base64data = reader.result as string;
      const newTabId = 'doc-caucion-' + Date.now();

      this.appState.addTab({
        id: newTabId,
        name: 'Caución de Seguridad',
        icon: 'fas fa-shield-alt',
        type: 'pdf-viewer',
        content: safeUrl,
        url: safeUrl,
        blobData: base64data,
        originalName: fileName,
        filePath: '',
        isProtected: true,
        isSavedToHistory: false,
        showToolbar: true,
        zoomLevel: 1.0,
        mimeType: 'application/pdf',
        csvHeader: [],
        csvRows: []
      });
      
      // Auto navega a la nueva pestaña generada directamente
      this.appState.setActiveTab(newTabId);
    };
  }
}
