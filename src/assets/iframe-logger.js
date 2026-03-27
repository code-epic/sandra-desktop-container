(function() {
    // Configuración
    const appId = window.APP_ID || 'external-app'; 
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalFetch = window.fetch;
    const OriginalXHR = window.XMLHttpRequest;

    function sendToParent(type, message, details = null) {
      if (window.parent) {
        window.parent.postMessage({
          type: 'SDC_LOG',
          payload: {
            app_id: appId,
            log_type: type, // 'FETCH', 'XHR', 'ERROR', 'INFO'
            message: message,
            details: details // Objeto estructurado
          }
        }, '*');
      }
    }

    // 1. Interceptar Console
    console.log = function(...args) {
      originalLog.apply(console, args);
      sendToParent('INFO', args.join(' '));
    };

    console.error = function(...args) {
      originalError.apply(console, args);
      const msg = args.map(a => (a instanceof Error ? a.message + '\n' + a.stack : a)).join(' ');
      sendToParent('ERROR', msg);
    };
    
    console.warn = function(...args) {
      originalWarn.apply(console, args);
      sendToParent('WARN', args.join(' '));
    };

    // Helper para detectar y reescribir URLs externas absolutas
    function interceptAndRewriteUrl(originalUrl) {
        let urlStr = originalUrl ? originalUrl.toString() : '';
        // Solo reescribimos si es una URL absoluta hacia http/https externa
        if (urlStr.startsWith('http://') || urlStr.startsWith('https://')) {
            if (!urlStr.includes('localhost') && !urlStr.includes('127.0.0.1')) {
                return `sandra-app://localhost/external-proxy/${appId}?target=${encodeURIComponent(urlStr)}`;
            }
        }
        return urlStr;
    }

    // 2. Interceptar Fetch (Red)
    window.fetch = async function(...args) {
        const [resource, config] = args;
        const originalUrl = resource.toString();
        const rewrittenUrl = interceptAndRewriteUrl(originalUrl);
        
        args[0] = rewrittenUrl;

        try {
            // El log de éxito (o error HTTP 400+) ahora lo emite Rust nativamente (sandra-app://)
            const response = await originalFetch(...args);
            return response;
        } catch (err) {
            // Solo logeamos errores a nivel de red/JS (ej. Timeout, CORS bloqueado localmente)
            sendToParent('ERROR', `Fetch Exception: ${originalUrl} - ${err.message}`, {
                url: originalUrl,
                error: err.message
            });
            throw err;
        }
    };

    // 3. Interceptar XHR (XMLHttpRequest)
    window.XMLHttpRequest = function() {
        const xhr = new OriginalXHR();
        let method = 'GET';
        let originalUrl = '';

        const originalOpen = xhr.open;
        xhr.open = function(m, u, ...args) {
            method = m;
            originalUrl = u ? u.toString() : '';
            const rewrittenUrl = interceptAndRewriteUrl(originalUrl);
            return originalOpen.apply(xhr, [m, rewrittenUrl, ...args]);
        };

        xhr.addEventListener('error', function() {
             sendToParent('ERROR', `XHR Network Exception: ${method} ${originalUrl}`, { url: originalUrl, method: method });
        });

        // NOTA: Rust se encarga de logear los accesos completados en XHR también.
        return xhr;
    };

    // Copiar propiedades estáticas
    Object.assign(window.XMLHttpRequest, OriginalXHR);

    sendToParent('INFO', `Monitor (Fetch/XHR Proxy) y Logger iniciado para ${appId}`);

})();
