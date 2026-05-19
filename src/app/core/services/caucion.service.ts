import { Injectable } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import jsPDF from 'jspdf';
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

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;

    // Colores institucionales
    const titleColor: [number, number, number] = [46, 125, 50]; // Verde oscuro
    const textColor: [number, number, number] = [33, 33, 33];
    const lightText: [number, number, number] = [117, 117, 117];

    // --- ENCABEZADO ---
    doc.setFontSize(16);
    doc.setTextColor(...titleColor);
    doc.setFont('helvetica', 'bold');
    doc.text('REPÚBLICA BOLIVARIANA DE VENEZUELA', pageWidth / 2, 20, { align: 'center' });
    
    doc.setFontSize(14);
    doc.text('CAUCIÓN DE CONFIDENCIALIDAD Y RESPONSABILIDAD', pageWidth / 2, 28, { align: 'center' });
    doc.text('SISTEMA DE GESTIÓN Y ACCESO (SANDRA)', pageWidth / 2, 35, { align: 'center' });

    doc.setDrawColor(224, 224, 224);
    doc.setLineWidth(0.5);
    doc.line(20, 40, pageWidth - 20, 40);

    // --- DATOS DEL USUARIO ---
    doc.setFontSize(11);
    doc.setTextColor(...textColor);
    doc.setFont('helvetica', 'bold');
    doc.text('1. IDENTIFICACIÓN DEL USUARIO AUTORIZADO', 20, 50);

    doc.setFont('helvetica', 'normal');
    const startY = 60;
    const lineSpacing = 7;
    doc.text(`Cédula de Identidad: ${usr.cedula || 'N/A'}`, 25, startY);
    doc.text(`Nombres y Apellidos: ${usr.nombre || 'N/A'}`, 25, startY + lineSpacing);
    doc.text(`Nombre de Usuario: ${usr.usuario || 'N/A'}`, 25, startY + lineSpacing * 2);
    doc.text(`Cargo / Perfil: ${usr.cargo || usr.Perfil?.descripcion || 'N/A'}`, 25, startY + lineSpacing * 3);
    doc.text(`Sistema / Área: ${usr.sistema || 'N/A'}`, 25, startY + lineSpacing * 4);
    
    // --- TEXTO LEGAL Y COMPROMISOS ---
    doc.setFont('helvetica', 'bold');
    doc.text('2. DECLARACIÓN JURADA Y BASAMENTO LEGAL', 20, startY + lineSpacing * 6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    
    const textoLegal = `Quien suscribe, debidamente identificado en el presente documento, declaro bajo fe de juramento que he recibido credenciales de acceso intransferibles para hacer uso de las Tecnologías de Información gestionadas en la infraestructura del Sistema SANDRA. Por consiguiente, asumo plena responsabilidad legal y administrativa por todas las acciones ejecutadas a través de este usuario, y me comprometo a cumplir con los siguientes términos basados en la legislación nacional vigente:

1. LEY ESPECIAL CONTRA LOS DELITOS INFORMÁTICOS (G.O. N° 37.313):
Comprendo que el acceso indebido, sabotaje, espionaje informático, y la revelación indebida de data o información de carácter confidencial o restringido (Arts. 6, 7, 11 y 22), constituyen delitos penados por la ley con pena de prisión y multas.

2. LEY DE INFOGOBIERNO (G.O. N° 40.274):
Estoy consciente de que el uso de los sistemas del Estado debe regirse por los principios de transparencia y seguridad. No emplearé mi acceso para fines ajenos a mis funciones oficiales ni comprometeré la integridad de la plataforma tecnológica institucional.

3. LEY SOBRE MENSAJES DE DATOS Y FIRMAS ELECTRÓNICAS (G.O. N° 37.148):
Acepto que mi acceso al sistema está asociado a una traza de auditoría, dirección física (MAC) e IP, los cuales tendrán la misma validez y eficacia probatoria que la ley otorga a los documentos escritos (Art. 4).

4. NORMAS DE SEGURIDAD DE LA INFORMACIÓN:
Me comprometo a no revelar, compartir, ceder ni publicar mis credenciales de acceso (usuario, contraseña, token), ni extraer datos sensibles para usos no autorizados. Entiendo que la sesión actual posee firmas digitales temporales que me vinculan unívocamente a los actos realizados.`;

    const textoFormat = doc.splitTextToSize(textoLegal, pageWidth - 40);
    doc.text(textoFormat, 20, startY + lineSpacing * 7.5);

    // --- BLOQUE DE AUDITORÍA Y FIRMA ---
    const auditoriaY = startY + lineSpacing * 8 + (textoFormat.length * 4.5) + 10;
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('3. CERTIFICACIÓN DE FIRMA DIGITAL Y TRAZA DE AUDITORÍA', 20, auditoriaY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...lightText);
    
    // Si hay firma digital en el token
    if (firma) {
      doc.text(`Dirección MAC Autorizada: ${firma.direccionmac || 'N/A'}`, 25, auditoriaY + 10);
      doc.text(`Timestamp de Emisión: ${firma.tiempo || 'N/A'}`, 25, auditoriaY + 16);
      doc.text(`ID de Sesión (SID): ${payload.sid || 'N/A'}`, 25, auditoriaY + 22);
      doc.text(`Nivel de Seguridad: ${firma.nivel || 'Estándar'}`, 25, auditoriaY + 28);
    } else {
      doc.text('No se detectaron firmas criptográficas en la sesión actual.', 25, auditoriaY + 10);
    }

    doc.setDrawColor(224, 224, 224);
    doc.setLineWidth(0.5);
    doc.line(20, auditoriaY + 35, pageWidth - 20, auditoriaY + 35);

    // --- CAJETÍN DE FIRMA ACEPTACIÓN ---
    doc.setTextColor(...textColor);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('ACEPTACIÓN DIGITAL', pageWidth / 2, auditoriaY + 50, { align: 'center' });
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.text('Este documento es generado automáticamente por el Sistema SANDRA.', pageWidth / 2, auditoriaY + 55, { align: 'center' });
    doc.text(`Fecha y Hora de Generación: ${new Date().toLocaleString('es-VE')}`, pageWidth / 2, auditoriaY + 60, { align: 'center' });
    
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
