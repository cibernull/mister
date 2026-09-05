#!/bin/bash
# Actualiza los datos de Mister y deja la página lista para publicar.
#
# Lo lanza launchd cada hora. No necesita a Claude para nada: son dos scripts
# de Node, y por eso vive aquí y no en una tarea programada de la app.
#
# El reparto es ese: esto mantiene los datos siempre frescos pase lo que pase, y
# la tarea de la app solo tiene que subir el fichero. Si la app está cerrada o
# ocupada, lo único que se retrasa es la copia publicada; los datos del Mac
# siguen al día y la próxima subida los lleva enteros.
#
# launchd no hereda el PATH de nadie, así que la ruta de node se escribe dentro
# al instalar.
set -u

PROYECTO="__PROYECTO__"
NODE="__NODE__"
REGISTRO="${TMPDIR:-/tmp}/liga-de-mister-refresco.log"

exec >>"$REGISTRO" 2>&1
echo "── $(date '+%Y-%m-%d %H:%M:%S') ── refrescando"

[ -x "$NODE" ] || { echo "no encuentro node en $NODE"; exit 1; }
cd "$PROYECTO" || { echo "no encuentro el proyecto en $PROYECTO"; exit 1; }
export PATH="$(dirname "$NODE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# La actualización se protege sola: si no cuadra con Mister, no escribe nada y
# sale con error. En ese caso no se publica, que es lo correcto.
if ! npx tsx src/actualizacion/actualizar.ts; then
  echo "la actualización no cuadró; no toco la página publicada"
  exit 1
fi
echo ""
node modulo/publicar.cjs
