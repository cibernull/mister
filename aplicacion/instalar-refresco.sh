#!/bin/bash
# Instala el refresco horario como agente de launchd.
#
#   npm run instalar-refresco
#
# launchd es el programador del propio macOS: corre esté abierta o no la app de
# Claude, y no depende de que nadie esté mirando. Se queda registrado para este
# usuario, no para todo el sistema.
#
# Para quitarlo:
#   launchctl bootout gui/$(id -u)/com.cibernull.ligademister.refresco
#   rm ~/Library/LaunchAgents/com.cibernull.ligademister.refresco.plist
set -euo pipefail

PROYECTO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ETIQUETA="com.cibernull.ligademister.refresco"
PLIST="$HOME/Library/LaunchAgents/$ETIQUETA.plist"
# El guion NO puede vivir en el proyecto: está bajo ~/Documents, que macOS
# protege, y launchd no puede ejecutar nada de ahí — sale con código 126 y
# «Operation not permitted», sin dejar rastro en ningún log. Desde fuera sí
# puede luego leer y escribir dentro del proyecto; lo que se bloquea es
# arrancar el ejecutable.
CASA="$HOME/Library/Application Support/liga-de-mister"
GUION="$CASA/refrescar.sh"

NODE_REAL="$(command -v node || true)"
[ -n "$NODE_REAL" ] || { echo "No encuentro node en el PATH. Ejecuta esto desde un Terminal normal." >&2; exit 1; }

mkdir -p "$CASA"
sed -e "s|__PROYECTO__|$PROYECTO|" -e "s|__NODE__|$NODE_REAL|" \
  "$PROYECTO/aplicacion/refrescar.sh" > "$GUION"
chmod +x "$GUION"

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLI
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$ETIQUETA</string>
  <key>ProgramArguments</key><array><string>$GUION</string></array>
  <!-- Cada hora en punto, de 9 a 23. Fuera de eso el mercado no se mueve. -->
  <key>StartCalendarInterval</key>
  <array>
$(for h in 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23; do
  printf '    <dict><key>Hour</key><integer>%s</integer><key>Minute</key><integer>0</integer></dict>\n' "$h"
done)
  </array>
  <!-- Si el Mac estaba dormido a esa hora, launchd lo lanza al despertar. -->
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>/tmp/liga-de-mister-launchd.log</string>
  <key>StandardErrorPath</key><string>/tmp/liga-de-mister-launchd.log</string>
</dict>
</plist>
PLI

launchctl bootout "gui/$(id -u)/$ETIQUETA" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

# Comprobar que ha quedado registrado de verdad. `bootstrap` puede salir con
# cero y no dejar el servicio puesto, y entonces el instalador dice «Instalado»
# mientras el refresco no corre nunca — que es lo que pasó la primera vez.
if ! launchctl list | grep -q "$ETIQUETA"; then
  echo "El agente no ha quedado registrado. Prueba a cerrar sesión y volver a entrar." >&2
  exit 1
fi

echo "Instalado y comprobado: $ETIQUETA"
echo "  guion:  $GUION"
echo "  plist:  $PLIST"
echo "  diario: ${TMPDIR:-/tmp}liga-de-mister-refresco.log"
echo
echo "Probarlo ahora:  launchctl kickstart -p gui/$(id -u)/$ETIQUETA"
