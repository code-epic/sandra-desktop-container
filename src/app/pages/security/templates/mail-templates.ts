export interface TemplateData {
  user: string;
  cargo: string;
  date: string;
  reference?: string;
}

export const MAIL_TEMPLATES: { [key: string]: (data: TemplateData) => string } = {
  'MEMO': (data) => `
    <div class="sandra-template memo-template" style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #1e293b; line-height: 1.6; background: #fff;">
      <div style="text-align: center; margin-bottom: 40px;">
        <h2 style="text-transform: uppercase; letter-spacing: 2px; border-bottom: 2px solid #1e293b; display: inline-block; padding-bottom: 8px;">Memorándum</h2>
        <p style="font-weight: bold; margin-top: 10px;">Nro: SND-${new Date().getFullYear()}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}</p>
      </div>
      
      <div style="margin-bottom: 30px;">
        <p><strong>PARA:</strong> <span style="color: #64748b;">[Destinatario]</span></p>
        <p><strong>DE:</strong> ${data.user} (${data.cargo})</p>
        <p><strong>FECHA:</strong> ${data.date}</p>
        <p><strong>ASUNTO:</strong> <span style="color: #64748b;">[Asunto del Memorándum]</span></p>
      </div>

      <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 30px 0;">

      <div style="min-height: 200px; text-align: justify;">
        <p>Por medio de la presente, se hace de su conocimiento que...</p>
      </div>

      <div style="margin-top: 60px; text-align: center;">
        <p>Atentamente,</p>
        <br><br>
        <div style="display: inline-block; border-top: 1px solid #1e293b; padding-top: 10px; min-width: 250px;">
          <p><strong>${data.user}</strong></p>
          <p style="font-size: 0.9rem; color: #64748b;">${data.cargo}</p>
        </div>
      </div>
    </div>
  `,

  'PUNTO_CUENTA': (data) => `
    <div class="sandra-template pc-template" style="font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto; border: 1px solid #000; background: #fff; color: #000;">
      <!-- Encabezado -->
      <table style="width: 100%; border-bottom: 2px solid #000; border-collapse: collapse;">
        <tr>
          <td style="width: 20%; padding: 10px; border-right: 1px solid #000; text-align: center;">
            <img src="assets/img/logo_sandra_dark.png" alt="Sandra Logo" style="max-width: 80px; filter: grayscale(1);">
          </td>
          <td style="width: 50%; padding: 10px; border-right: 1px solid #000; text-align: center;">
            <h2 style="margin: 0; font-size: 14pt; text-transform: uppercase;">Punto de Cuenta</h2>
            <p style="margin: 5px 0 0 0; font-size: 10pt; font-weight: bold;">SISTEMA DE ADMINISTRACIÓN Y NOTIFICACIÓN DE RIESGOS AUDITABLES</p>
          </td>
          <td style="width: 30%; padding: 0;">
            <table style="width: 100%; height: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 5px; border-bottom: 1px solid #000; font-size: 9pt;"><strong>FECHA:</strong> ${data.date}</td>
              </tr>
              <tr>
                <td style="padding: 5px; font-size: 9pt;"><strong>NÚMERO:</strong> SND-PC-${new Date().getFullYear()}-${Math.floor(Math.random() * 1000)}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Presentado por -->
      <div style="padding: 10px; border-bottom: 1px solid #000; background: #f8fafc;">
        <p style="margin: 0; font-size: 10pt;"><strong>PRESENTANTE:</strong> ${data.user} / ${data.cargo}</p>
      </div>

      <!-- Cuerpo del Punto de Cuenta -->
      <div style="padding: 0;">
        <div style="background: #e11d48; color: #fff; padding: 5px 10px; font-weight: bold; font-size: 11pt; text-transform: uppercase;">Asunto:</div>
        <div style="padding: 15px; border-bottom: 1px solid #000; min-height: 60px; font-size: 10pt;">
          SOLICITUD DE AUTORIZACIÓN PARA...
        </div>

        <div style="background: #e11d48; color: #fff; padding: 5px 10px; font-weight: bold; font-size: 11pt; text-transform: uppercase;">Argumentación / Situación:</div>
        <div style="padding: 15px; border-bottom: 1px solid #000; min-height: 150px; font-size: 10pt; text-align: justify;">
          Se somete a consideración la siguiente propuesta técnica basada en el análisis de riesgos del Nodo...
        </div>

        <div style="background: #e11d48; color: #fff; padding: 5px 10px; font-weight: bold; font-size: 11pt; text-transform: uppercase;">Propuesta:</div>
        <div style="padding: 15px; border-bottom: 1px solid #000; min-height: 100px; font-size: 10pt; text-align: justify;">
          Se propone la activación inmediata del protocolo de contingencia...
        </div>
      </div>

      <!-- Decisión -->
      <div style="padding: 0;">
        <div style="background: #000; color: #fff; padding: 5px 10px; font-weight: bold; font-size: 11pt; text-transform: uppercase;">Decisión de la Autoridad:</div>
        <table style="width: 100%; border-collapse: collapse; text-align: center;">
          <tr>
            <td style="width: 25%; padding: 15px; border: 1px solid #000;">
              <div style="border: 2px solid #000; width: 25px; height: 25px; margin: 0 auto 5px auto;"></div>
              <span style="font-size: 9pt; font-weight: bold;">APROBADO</span>
            </td>
            <td style="width: 25%; padding: 15px; border: 1px solid #000;">
              <div style="border: 2px solid #000; width: 25px; height: 25px; margin: 0 auto 5px auto;"></div>
              <span style="font-size: 9pt; font-weight: bold;">NEGADO</span>
            </td>
            <td style="width: 25%; padding: 15px; border: 1px solid #000;">
              <div style="border: 2px solid #000; width: 25px; height: 25px; margin: 0 auto 5px auto;"></div>
              <span style="font-size: 9pt; font-weight: bold;">VISTO</span>
            </td>
            <td style="width: 25%; padding: 15px; border: 1px solid #000;">
              <div style="border: 2px solid #000; width: 25px; height: 25px; margin: 0 auto 5px auto;"></div>
              <span style="font-size: 9pt; font-weight: bold;">DIFERIDO</span>
            </td>
          </tr>
        </table>
      </div>

      <!-- Firmas -->
      <div style="padding: 30px 10px; display: flex; justify-content: space-around; background: #fff;">
        <div style="text-align: center; width: 40%;">
          <br><br>
          <div style="border-top: 1px solid #000; padding-top: 5px;">
            <p style="margin: 0; font-size: 9pt;"><strong>${data.user}</strong></p>
            <p style="margin: 0; font-size: 8pt;">Presentante</p>
          </div>
        </div>
        <div style="text-align: center; width: 40%;">
          <br><br>
          <div style="border-top: 1px solid #000; padding-top: 5px;">
            <p style="margin: 0; font-size: 9pt;"><strong>AUTORIDAD SUPERIOR</strong></p>
            <p style="margin: 0; font-size: 8pt;">Firma y Sello</p>
          </div>
        </div>
      </div>
    </div>
  `,

  'RADIOGRAMA': (data) => `
    <div class="sandra-template radio-template" style="font-family: 'Courier New', Courier, monospace; background: #f1f5f9; padding: 30px; border: 2px solid #475569; color: #0f172a; max-width: 800px; margin: 0 auto;">
      <div style="border-bottom: 2px solid #475569; margin-bottom: 20px; padding-bottom: 10px;">
        <p style="margin: 0; font-weight: bold; font-size: 1.2rem;">*** RADIOGRAMA INTEGRADO SANDRA ***</p>
      </div>
      
      <table style="width: 100%; margin-bottom: 20px;">
        <tr>
          <td style="width: 50%;"><strong>ORIGEN:</strong> SANDRA_NODE_V3</td>
          <td style="width: 50%;"><strong>PRIORIDAD:</strong> <span style="background: #000; color: #fff; padding: 2px 5px;">FLASH</span></td>
        </tr>
        <tr>
          <td><strong>FECHA:</strong> ${data.date}</td>
          <td><strong>REF:</strong> SG-RAD-${Math.floor(Math.random() * 9999)}</td>
        </tr>
      </table>

      <div style="border: 1px dashed #475569; padding: 20px; background: #fff; min-height: 200px; text-transform: uppercase;">
        TEXTO DEL MENSAJE:<br><br>
        SOLICITO VERIFICACIÓN INMEDIATA DE PARÁMETROS EN EL NODO DESTINO. CORTE.<br><br>
        SIN MÁS QUE REFERIR. CORTE Y CIERRE.
      </div>

      <div style="margin-top: 30px;">
        <p><strong>AUTORIZADO POR:</strong> ${data.user.toUpperCase()}</p>
        <p><strong>CARGO:</strong> ${data.cargo.toUpperCase()}</p>
        <p style="font-size: 0.8rem; margin-top: 20px; border-top: 1px solid #475569; padding-top: 5px;">Cifrado de Seguridad: AES-256-SND-SEC</p>
      </div>
    </div>
  `,

  'COMUNICADO': (data) => `
    <div class="sandra-template comunicado-template" style="font-family: 'Inter', sans-serif; text-align: center; padding: 50px; border: 8px double #10b981; max-width: 850px; margin: 0 auto; background: #fff;">
      <div style="margin-bottom: 30px;">
        <h1 style="color: #059669; font-size: 2.5rem; margin: 0; letter-spacing: 3px;">COMUNICADO OFICIAL</h1>
        <div style="width: 60px; height: 4px; background: #10b981; margin: 15px auto;"></div>
        <p style="text-transform: uppercase; font-weight: bold; color: #64748b; font-size: 0.9rem;">División de Seguridad de Datos Sandra</p>
      </div>

      <div style="text-align: justify; line-height: 1.8; color: #334155; padding: 0 40px; margin-bottom: 40px;">
        <p style="font-size: 1.1rem;">Se informa a todo el personal de la institución que, a partir del día de hoy <strong>${data.date}</strong>, el sistema de auditoría ha sido actualizado bajo los protocolos internacionales de integridad gubernamental.</p>
        <p>Todos los usuarios deberán...</p>
      </div>

      <div style="margin-top: 50px;">
        <p style="margin: 0; font-weight: bold; color: #059669;">Emisario del Comunicado:</p>
        <p style="margin: 0; font-size: 1.2rem;"><strong>${data.user}</strong></p>
        <p style="margin: 0; color: #64748b;">${data.cargo}</p>
      </div>
      
      <div style="margin-top: 40px; font-size: 0.8rem; color: #94a3b8;">
        Documento Certificado Digitalmente por la Infraestructura Sandra Node V2.
      </div>
    </div>
  `
};
