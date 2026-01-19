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

    // 2. Interceptar Fetch (Red)
    window.fetch = async function(...args) {
        const [resource, config] = args;
        const url = resource.toString();
        const method = (config && config.method) ? config.method : 'GET';
        // Capturar params/body
        const requestBody = (config && config.body) ? config.body : null;

        try {
            const response = await originalFetch(...args);
            
            // Solo capturamos si hay error o si queremos debug profundo (segun requerimiento "capturar eventos")
            // El usuario dijo "capturar eventos 403, 404...", pero tambien "mejorar detalles XHR".
            // Asumimos que para Fetch aplicamos logica similar: reporte completo en error.

            if (response.status >= 400) {
                let responseBody = '[No Body]';
                try {
                    responseBody = await response.clone().text();
                    if (responseBody.length > 5000) responseBody = responseBody.substring(0, 5000) + '... (truncated)';
                } catch(e) {}

                const msg = `HTTP Error ${response.status} ${method} ${url}`;

                sendToParent('FETCH', msg, {
                    url: response.url || url,
                    method: method,
                    status: response.status,
                    request_headers: (config && config.headers) ? config.headers : {},
                    request_payload: requestBody,
                    response_body: responseBody,
                    source: appId
                });
            }
            
            return response;
        } catch (err) {
            sendToParent('ERROR', `Fetch Exception: ${url} - ${err.message}`, {
                url: url,
                error: err.message
            });
            throw err;
        }
    };

    // 3. Interceptar XHR (XMLHttpRequest)
    window.XMLHttpRequest = function() {
        const xhr = new OriginalXHR();
        let method = 'GET';
        let url = '';
        let requestBody = null;
        const requestHeaders = {};

        const originalOpen = xhr.open;
        xhr.open = function(m, u, ...args) {
            method = m;
            url = u;
            return originalOpen.apply(xhr, [m, u, ...args]);
        };

        const originalSetRequestHeader = xhr.setRequestHeader;
        xhr.setRequestHeader = function(header, value) {
            requestHeaders[header] = value;
            return originalSetRequestHeader.apply(xhr, [header, value]);
        };

        const originalSend = xhr.send;
        xhr.send = function(body) {
            requestBody = body; // Capturamos lo que se envia
            return originalSend.apply(xhr, [body]);
        };

        xhr.addEventListener('loadend', function() {
            if (xhr.status >= 400) {
                let responseBody = xhr.responseText || '[No Body]';
                if (responseBody.length > 5000) responseBody = responseBody.substring(0, 5000) + '... (truncated)';
                
                // Mensaje corto para la lista
                const msg = `XHR Error ${xhr.status} ${method} ${url}`;
                
                // Detalles completos para el modal / guardado
                sendToParent('FETCH', msg, {
                    url: xhr.responseURL || url,
                    method: method,
                    status: xhr.status,
                    request_headers: requestHeaders,
                    request_payload: requestBody,
                    response_body: responseBody,
                    source: appId
                });
            }
        });

        xhr.addEventListener('error', function() {
             sendToParent('ERROR', `XHR Network Exception: ${method} ${url}`, { url: url, method: method });
        });

        return xhr;
    };

    // Copiar propiedades estáticas
    Object.assign(window.XMLHttpRequest, OriginalXHR);

    sendToParent('INFO', `Monitor (XHR/Fetch) iniciado para ${appId}`);

})();
