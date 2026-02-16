self.addEventListener('push', (event) => {
  const data = event.data.json();
  self.registration.showNotification(data.title || 'Sandra Notification', {
    body: data.message || 'Nuevo mensaje recibido',
    icon: '/assets/sandra-logo.png',
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Puedes agregar lógica para abrir una pestaña específica aquí
});
