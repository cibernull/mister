#!/usr/bin/env python3
"""Dibuja el icono de la app y lo empaqueta en un .icns.

    python3 aplicacion/icono.py

Se dibuja a 4× y se reduce con Lanczos: es la forma barata de tener bordes
limpios sin pelearse con el antialias de cada primitiva.

La forma es la de macOS Big Sur en adelante, que no es un rectángulo redondeado
sino una superelipse —la esquina entra en la curva mucho antes—. Aproximarla
con `rounded_rectangle` se nota al lado de los iconos del sistema, así que se
calcula punto a punto.

Los colores son los de la propia app: verde de césped casi negro y el ámbar del
dinero, que es de lo que va todo esto.
"""
from __future__ import annotations

import math
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

AQUI = Path(__file__).resolve().parent
MAESTRO = 1024
ESCALA = 4
L = MAESTRO * ESCALA  # lienzo de trabajo

VERDE_ALTO = (28, 60, 40)
VERDE_BAJO = (8, 12, 10)
AMBAR_ALTO = (250, 214, 126)
AMBAR_BAJO = (196, 124, 16)
FUENTE = "/System/Library/Fonts/Avenir Next.ttc"


def superelipse(lado: int, margen: int, n: float = 5.0, pasos: int = 2048):
    """Los puntos del contorno de un icono de macOS."""
    r = (lado - 2 * margen) / 2
    cx = cy = lado / 2
    puntos = []
    for i in range(pasos):
        t = 2 * math.pi * i / pasos
        ct, st = math.cos(t), math.sin(t)
        # Superelipse en forma paramétrica: el signo va aparte para que la
        # potencia fraccionaria no se encuentre con un número negativo.
        x = cx + r * math.copysign(abs(ct) ** (2 / n), ct)
        y = cy + r * math.copysign(abs(st) ** (2 / n), st)
        puntos.append((x, y))
    return puntos


def degradado(lado: int, arriba, abajo) -> Image.Image:
    """Un degradado vertical, dibujado línea a línea."""
    img = Image.new("RGB", (1, lado))
    px = img.load()
    for y in range(lado):
        t = y / (lado - 1)
        px[0, y] = tuple(round(a + (b - a) * t) for a, b in zip(arriba, abajo))
    return img.resize((lado, lado), Image.Resampling.BILINEAR)


def escudo(lado: int) -> list[tuple[float, float]]:
    """Un escudo de armas clásico: hombros rectos y los lados cayendo a punta.

    Se define con curvas de Bézier y se muestrea, en vez de con un polígono a
    mano, porque los lados tienen que curvarse de verdad: un escudo con los
    lados rectos parece un icono de antivirus.
    """
    an = lado * 0.44  # ancho
    al = lado * 0.52  # alto
    x0 = (lado - an) / 2
    y0 = (lado - al) / 2 - lado * 0.015  # un pelo alto: pesa más abajo

    izq, der = x0, x0 + an
    arr, aba = y0, y0 + al
    hombro = arr + al * 0.055

    def bezier(p0, p1, p2, p3, pasos=220):
        salida = []
        for i in range(pasos + 1):
            t = i / pasos
            u = 1 - t
            salida.append(
                (
                    u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0],
                    u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1],
                )
            )
        return salida

    r = an * 0.13  # redondeo de los hombros
    puntos = [(izq + r, arr)]
    puntos += bezier((izq + r, arr), (izq, arr), (izq, arr), (izq, hombro))
    # Lado izquierdo cayendo hasta la punta.
    puntos += bezier((izq, hombro), (izq, aba - al * 0.30), (izq + an * 0.24, aba - al * 0.055), (lado / 2, aba))
    # Y subiendo por el derecho.
    puntos += bezier((lado / 2, aba), (der - an * 0.24, aba - al * 0.055), (der, aba - al * 0.30), (der, hombro))
    puntos += bezier((der, hombro), (der, arr), (der, arr), (der - r, arr))
    return puntos


def construir() -> Image.Image:
    # ── Fondo ────────────────────────────────────────────────────────────────
    # El margen deja el aire que macOS espera alrededor del icono; sin él se ve
    # más grande que los del sistema y canta.
    margen = int(L * 0.085)
    contorno = superelipse(L, margen)

    mascara = Image.new("L", (L, L), 0)
    ImageDraw.Draw(mascara).polygon(contorno, fill=255)

    fondo = degradado(L, VERDE_ALTO, VERDE_BAJO)

    # Un foco arriba a la izquierda, como la luz de un estadio. Se hace con un
    # círculo muy desenfocado, que es más barato que un degradado radial real.
    luz = Image.new("L", (L, L), 0)
    d = ImageDraw.Draw(luz)
    cx, cy, r = L * 0.34, L * 0.24, L * 0.42
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=90)
    luz = luz.filter(ImageFilter.GaussianBlur(L * 0.13))
    fondo = Image.composite(Image.new("RGB", (L, L), (74, 122, 88)), fondo, luz)

    lienzo = Image.new("RGBA", (L, L), (0, 0, 0, 0))
    lienzo.paste(fondo, (0, 0), mascara)

    # El filo de cristal del borde superior: una línea clara siguiendo el
    # contorno, recortada a la mitad de arriba. Es lo que da el aspecto de
    # objeto y no de pegatina.
    filo = Image.new("RGBA", (L, L), (0, 0, 0, 0))
    ImageDraw.Draw(filo).line(contorno + [contorno[0]], fill=(255, 255, 255, 58), width=int(L * 0.006))
    corte = Image.new("L", (L, L), 0)
    ImageDraw.Draw(corte).rectangle([0, 0, L, int(L * 0.5)], fill=255)
    corte = corte.filter(ImageFilter.GaussianBlur(L * 0.06))
    filo.putalpha(Image.composite(filo.getchannel("A"), Image.new("L", (L, L), 0), corte))
    lienzo = Image.alpha_composite(lienzo, filo)

    # ── Escudo ───────────────────────────────────────────────────────────────
    forma = escudo(L)

    sombra = Image.new("RGBA", (L, L), (0, 0, 0, 0))
    ImageDraw.Draw(sombra).polygon([(x, y + L * 0.016) for x, y in forma], fill=(0, 0, 0, 165))
    sombra = sombra.filter(ImageFilter.GaussianBlur(L * 0.018))
    lienzo = Image.alpha_composite(lienzo, Image.composite(sombra, Image.new("RGBA", (L, L), (0, 0, 0, 0)), mascara))

    mEscudo = Image.new("L", (L, L), 0)
    ImageDraw.Draw(mEscudo).polygon(forma, fill=255)
    capa = Image.new("RGBA", (L, L), (0, 0, 0, 0))
    capa.paste(degradado(L, AMBAR_ALTO, AMBAR_BAJO), (0, 0), mEscudo)

    # Filo de luz por dentro del borde de arriba. Sin él el escudo es una
    # silueta plana; con él parece una pieza con canto, que es la diferencia
    # entre un icono correcto y uno que apetece mirar.
    rim = Image.new("RGBA", (L, L), (0, 0, 0, 0))
    ImageDraw.Draw(rim).line(forma + [forma[0]], fill=(255, 246, 222, 210), width=int(L * 0.007))
    arriba = Image.new("L", (L, L), 0)
    ImageDraw.Draw(arriba).rectangle([0, 0, L, int(L * 0.46)], fill=255)
    arriba = arriba.filter(ImageFilter.GaussianBlur(L * 0.05))
    rim.putalpha(Image.composite(rim.getchannel("A"), Image.new("L", (L, L), 0), arriba))
    # Solo por dentro: encoger la máscara del escudo evita que el filo se
    # desborde y ensucie el fondo.
    dentro = mEscudo.filter(ImageFilter.MinFilter(3))
    rim.putalpha(Image.composite(rim.getchannel("A"), Image.new("L", (L, L), 0), dentro))
    capa = Image.alpha_composite(capa, rim)

    # ── El símbolo, recortado del escudo ─────────────────────────────────────
    # Recortado y no encima: así el escudo se lee como una pieza sólida con un
    # hueco, que tiene más cuerpo que un símbolo pegado.
    fuente = ImageFont.truetype(FUENTE, int(L * 0.26), index=0)
    for i in range(12):
        try:
            f = ImageFont.truetype(FUENTE, int(L * 0.26), index=i)
            if "Heavy" in (f.getname()[1] or "") or "Bold" in (f.getname()[1] or ""):
                fuente = f
                break
        except Exception:
            break

    texto = Image.new("L", (L, L), 0)
    dt = ImageDraw.Draw(texto)
    caja = dt.textbbox((0, 0), "€", font=fuente)
    dt.text(
        ((L - (caja[2] - caja[0])) / 2 - caja[0], (L - (caja[3] - caja[1])) / 2 - caja[1] - L * 0.028),
        "€",
        font=fuente,
        fill=255,
    )
    hueco = capa.getchannel("A").point(lambda v: v)
    capa.putalpha(Image.composite(Image.new("L", (L, L), 0), hueco, texto))

    return Image.alpha_composite(lienzo, capa)


def main() -> int:
    print("Dibujando a", L, "px…")
    img = construir()
    maestro = img.resize((MAESTRO, MAESTRO), Image.Resampling.LANCZOS)

    iconset = AQUI / "icono.iconset"
    if iconset.exists():
        for f in iconset.iterdir():
            f.unlink()
    iconset.mkdir(exist_ok=True)

    for tam in (16, 32, 128, 256, 512):
        img.resize((tam, tam), Image.Resampling.LANCZOS).save(iconset / f"icon_{tam}x{tam}.png")
        img.resize((tam * 2, tam * 2), Image.Resampling.LANCZOS).save(iconset / f"icon_{tam}x{tam}@2x.png")
    maestro.save(AQUI / "icono-1024.png")

    icns = AQUI / "icono.icns"
    r = subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(icns)], capture_output=True, text=True)
    if r.returncode != 0:
        print("iconutil falló:", r.stderr, file=sys.stderr)
        return 1
    print("Listo:", icns, f"({icns.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
