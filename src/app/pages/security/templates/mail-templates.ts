export interface TemplateData {
  user: string;
  cargo: string;
  date: string;
  reference?: string;
}

export const MAIL_TEMPLATES: { [key: string]: (data: TemplateData) => string } = {
  'MEMO': (data) => `
    <div class="sandra-template memo-template" style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #1e293b; line-height: 1.6; background: #fff;">
  
    </div>
  `,

  'PUNTO_CUENTA': (data) => `
    <div class="sandra-template pc-template" style="font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto; border: 1px solid #000; background: #fff; color: #000;">
    

     
    </div>
  `,

  'RADIOGRAMA': (data) => `
    <div class="sandra-template radio-template" style="font-family: 'Courier New', Courier, monospace; background: #f1f5f9; padding: 30px; border: 2px solid #475569; color: #0f172a; max-width: 800px; margin: 0 auto;">
      
    </div>
  `,

  'COMUNICADO': (data) => `
    <div class="sandra-template comunicado-template" style="font-family: 'Inter', sans-serif; text-align: center; padding: 50px; border: 8px double #10b981; max-width: 850px; margin: 0 auto; background: #fff;">
     
    </div>
  `
};
