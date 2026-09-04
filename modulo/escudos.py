#!/usr/bin/env python3
"""Descarga los escudos de los clubes y los deja listos para incrustar.

    python3 modulo/escudos.py

La página publicada no puede cargar imágenes del CDN de Mister: el visor solo
deja pasar tipografías de Google, y cualquier otra petición se bloquea sin
avisar —quedaría un hueco—. Así que los escudos viajan dentro del HTML, como
data URI.

Se reducen a 40 px: se pintan a 20, y a 40 se ven finos en pantalla retina sin
que los treinta y cuatro pasen de unos 165 KB en total, que en una página de
1,1 MB no se nota. En el original son de 160 px y ocuparían el doble.

Se ejecuta a mano y muy de vez en cuando: los escudos no cambian de una
temporada a otra, y los que faltan se piden solos la próxima vez.
"""
from __future__ import annotations

import base64
import io
import json
import sys
import urllib.request
from pathlib import Path

from PIL import Image

AQUI = Path(__file__).resolve().parent
CLUBES = AQUI / "datos" / "clubes.json"
SALIDA = AQUI / "datos" / "escudos.json"
CDN = "https://cdn-mister.mundodeportivo.com/file/cdn-common/teams/{}.png"
# Sin un User-Agent de navegador el CDN contesta 403 a todo.
AGENTE = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36"
LADO = 40


def main() -> int:
    if not CLUBES.exists():
        print("Falta modulo/datos/clubes.json. Ejecuta antes una actualización.", file=sys.stderr)
        return 1

    clubes = json.loads(CLUBES.read_text())
    escudos = json.loads(SALIDA.read_text()) if SALIDA.exists() else {}
    faltan = [i for i in clubes if i not in escudos]
    if not faltan:
        print(f"Ya están los {len(escudos)}.")
        return 0

    print(f"Bajando {len(faltan)} escudos…")
    fallidos = []
    for idClub in faltan:
        try:
            pet = urllib.request.Request(CDN.format(idClub), headers={"User-Agent": AGENTE})
            with urllib.request.urlopen(pet, timeout=20) as r:
                bruto = r.read()
            im = Image.open(io.BytesIO(bruto)).convert("RGBA").resize((LADO, LADO), Image.Resampling.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, "PNG", optimize=True)
            escudos[idClub] = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
        except Exception as e:  # noqa: BLE001 — un escudo que falle no vale una pasada
            fallidos.append(f"{clubes[idClub]} ({idClub}): {e}")

    SALIDA.write_text(json.dumps(escudos, indent=1, ensure_ascii=False) + "\n")
    kb = SALIDA.stat().st_size // 1024
    print(f"Listo: {len(escudos)} escudos, {kb} KB.")
    if fallidos:
        print("No pude con:\n  " + "\n  ".join(fallidos), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
