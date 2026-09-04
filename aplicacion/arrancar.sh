#!/bin/bash
# El ejecutable de La Liga de Mister.app.
#
# Hace tres cosas, en este orden:
#   1. mata lo que hubiera escuchando en el puerto, para que nunca falle por
#      «ya está ocupado» —que es justo lo que pasaba al abrirla dos veces—;
#   2. arranca el servidor y espera a que conteste antes de abrir el navegador,
#      porque abrirlo antes enseña un error de conexión;
#   3. sale. El servidor queda suelto y se apaga solo cuando la página deja de
#      mandar su latido, o sea al cerrar la pestaña.
#
# Sale a propósito en vez de quedarse esperando: macOS da por colgada a una app
# que no «termina de arrancar» y la cierra con un error -1712. Que el servidor
# viva por su cuenta evita esa pelea, y el latido ya se encarga de apagarlo.
#
# Un .app lanzado desde el Finder no hereda el PATH del Terminal, así que aquí
# no se puede dar por hecho que `node` esté a mano: hay que ir a buscarlo.
set -u

REGISTRO="${TMPDIR:-/tmp}/liga-de-mister.log"
exec >>"$REGISTRO" 2>&1
echo "── $(date '+%Y-%m-%d %H:%M:%S') ── arrancando"

PROYECTO="__PROYECTO__"
PUERTO="${PUERTO:-4788}"
URL="http://127.0.0.1:$PUERTO/"

aviso() {
  osascript -e "display alert \"La Liga de Mister\" message \"$1\" as critical giving up after 30" >/dev/null 2>&1
  exit 1
}

# ── node ─────────────────────────────────────────────────────────────────────
# La ruta buena la escribe el instalador, que sí corre en un Terminal con el
# PATH puesto. Hay tantos sitios donde puede vivir node —homebrew, nvm, pnpm,
# volta, el instalador oficial— que buscarla a ciegas es perder el tiempo; la
# lista de abajo es solo el plan B por si esa ruta desaparece.
NODE="__NODE__"
if [ ! -x "$NODE" ]; then
  NODE=""
  for c in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node \
           "$HOME/Library/pnpm/node" "$HOME/Library/pnpm/bin/node" "$HOME/.volta/bin/node"; do
    [ -x "$c" ] && NODE="$c" && break
  done
  [ -n "$NODE" ] || NODE=$(ls -1d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)
fi
[ -n "$NODE" ] && [ -x "$NODE" ] || aviso "No encuentro Node.js en este Mac. Si lo tienes instalado, vuelve a ejecutar en el Terminal: npm run instalar-app"
echo "node: $NODE"
[ -d "$PROYECTO" ] || aviso "No encuentro el proyecto en $PROYECTO. Si lo has movido, vuelve a instalar la app con: npm run instalar-app"

# El PATH que verá el servidor: necesita npx para lanzar las actualizaciones.
export PATH="$(dirname "$NODE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# ── 1. despejar el puerto ────────────────────────────────────────────────────
# Sin esto, abrir la app teniendo ya una abierta terminaba en «puerto ocupado»
# y la ventana nueva no servía para nada.
escuchando() { lsof -ti "tcp:$PUERTO" -sTCP:LISTEN 2>/dev/null; }
VIEJOS=$(escuchando)
if [ -n "$VIEJOS" ]; then
  echo "$VIEJOS" | xargs kill 2>/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ -z "$(escuchando)" ] && break
    sleep 0.3
  done
  # Si a los 3 segundos sigue ahí, es que no se va por las buenas.
  escuchando | xargs kill -9 2>/dev/null
fi

# ── 2. arrancar y esperar a que conteste ─────────────────────────────────────
echo "proyecto: $PROYECTO"
cd "$PROYECTO" || aviso "No pude entrar en $PROYECTO"
# El paréntesis importa: al morir la subshell, el servidor queda colgando de
# launchd y no de la app. Si siguiera siendo hijo suyo, macOS daría la app por
# «en ejecución» y el siguiente doble clic no volvería a lanzar este script —no
# pasaría absolutamente nada, que es peor que un error.
( nohup "$NODE" modulo/servidor.cjs --autocerrar --sin-abrir >>"$REGISTRO" 2>&1 & )

listo=0
for _ in $(seq 1 60); do
  if curl -s -o /dev/null --max-time 1 "$URL"; then listo=1; break; fi
  sleep 0.25
done

if [ "$listo" != "1" ]; then
  escuchando | xargs kill 2>/dev/null
  aviso "El servidor no llegó a arrancar. El registro está en $REGISTRO"
fi

# ── 3. navegador, y fuera ────────────────────────────────────────────────────
echo "servidor listo (pid $(escuchando | head -1)), abriendo $URL"
open "$URL"
exit 0
