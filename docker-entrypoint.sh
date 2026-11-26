#!/bin/sh
# Genera config.js en el arranque a partir de variables de entorno.
#
# Por que asi y no con las URL dentro del bundle: la misma imagen tiene que
# servir en desarrollo (puertos locales) y en AWS (rutas de API Gateway). Si las
# URL se compilaran dentro del JS habria que reconstruir la imagen para cada
# entorno, y la imagen dejaria de ser el mismo artefacto verificado.
#
# Variables que acepta, con el valor por defecto de desarrollo:
#   API_PAGOS            http://localhost:8083
#   API_RECOMENDACIONES  http://localhost:8084
#   API_ADMIN            http://localhost:8085
#   API_PRODUCTOS        http://localhost:8086
#   API_RABBIT           http://localhost:8089
#   API_NOTIFICACIONES   http://localhost:8088
#   WS_URL               (vacio: el tablero cae a leer de los servicios)
#
# En AWS, con API Gateway delante, las tres apuntan a la misma base y se
# diferencian por la ruta del recurso, por ejemplo:
#   API_PAGOS=https://abc123.execute-api.us-east-1.amazonaws.com/desarrollo

set -e

DESTINO=/usr/share/nginx/html/config.js

cat > "$DESTINO" <<EOF
/* ARCHIVO GENERADO EN EL ARRANQUE — no editar a mano, se sobrescribe.
   Generado: $(date -u '+%Y-%m-%d %H:%M:%S UTC') */
window.PEDIDOS360_CONFIG = {
  pagos:           "${API_PAGOS:-http://localhost:8083}",
  recomendaciones: "${API_RECOMENDACIONES:-http://localhost:8084}",
  admin:           "${API_ADMIN:-http://localhost:8085}",
  productos:       "${API_PRODUCTOS:-http://localhost:8086}",
  rabbit:          "${API_RABBIT:-http://localhost:8089}",
  notificaciones:  "${API_NOTIFICACIONES:-http://localhost:8088}",
  ws:              "${WS_URL:-}"
};
EOF

echo "[entrypoint] config.js generado:"
sed 's/^/[entrypoint]   /' "$DESTINO"

exec nginx -g 'daemon off;'
