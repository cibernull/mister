#!/bin/bash
# Construye «La Liga de Mister.app» y la deja en /Applications.
#
#   npm run instalar-app
#
# El bundle es de los de toda la vida: una carpeta con un Info.plist y un
# script ejecutable dentro. No hace falta Xcode ni firmar nada, porque la app
# no sale de este Mac.
#
# La ruta del proyecto se escribe dentro al construir, así que si mueves la
# carpeta hay que volver a ejecutar esto.
set -euo pipefail

PROYECTO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOMBRE="La Liga de Mister"
DESTINO="${1:-/Applications}"
APP="$DESTINO/$NOMBRE.app"

echo "Proyecto: $PROYECTO"
echo "Destino:  $APP"

# Se rehace entera: así no quedan restos de una versión anterior.
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$NOMBRE</string>
  <key>CFBundleDisplayName</key><string>$NOMBRE</string>
  <key>CFBundleIdentifier</key><string>com.cibernull.ligademister</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>arrancar</string>
  <key>CFBundleIconFile</key><string>icono</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <!-- Sin ventana propia: vive en el Dock mientras el servidor esté vivo y
       desaparece cuando se apaga. -->
  <key>LSBackgroundOnly</key><false/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

NODE_REAL="$(command -v node || true)"
[ -n "$NODE_REAL" ] || { echo "No encuentro node en el PATH. Ejecuta esto desde un Terminal normal." >&2; exit 1; }
echo "Node:     $NODE_REAL"

sed -e "s|__PROYECTO__|$PROYECTO|" -e "s|__NODE__|$NODE_REAL|" \
  "$PROYECTO/aplicacion/arrancar.sh" > "$APP/Contents/MacOS/arrancar"
chmod +x "$APP/Contents/MacOS/arrancar"

if [ -f "$PROYECTO/aplicacion/icono.icns" ]; then
  cp "$PROYECTO/aplicacion/icono.icns" "$APP/Contents/Resources/icono.icns"
fi

# El Finder cachea los bundles por fecha; tocarlo le obliga a releerlo.
touch "$APP"

echo
echo "Listo. Ábrela desde Aplicaciones, o con:  open -a \"$NOMBRE\""
