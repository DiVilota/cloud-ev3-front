/* Valores de DESARROLLO. En la imagen de producción este archivo lo sobrescribe
   docker-entrypoint.sh con las variables de entorno del contenedor. */
window.PEDIDOS360_CONFIG = {
  pagos: 'http://localhost:8083',
  recomendaciones: 'http://localhost:8084',
  admin: 'http://localhost:8085',
  productos: 'http://localhost:8086',
  rabbit: 'http://localhost:8089',
  notificaciones: 'http://localhost:8088',
  ws: '',
};
