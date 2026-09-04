# La app de escritorio

```bash
npm run instalar-app
```

Deja **La Liga de Mister.app** en `/Applications`. Doble clic y ya: arranca el
servidor, espera a que conteste y abre el navegador.

La ruta del proyecto y la de `node` se escriben dentro al instalar, así que
**si mueves la carpeta del proyecto hay que volver a ejecutar el comando**.

## Qué hace al abrirla

1. **Despeja el puerto.** Mata lo que estuviera escuchando en el 4788, que era
   lo que hacía fallar el segundo arranque con «el puerto ya está ocupado».
2. **Arranca el servidor y espera** a que responda antes de abrir el navegador.
   Abrirlo antes enseña un error de conexión durante un segundo.
3. **Abre el navegador y sale.**

## Y se cierra sola

La página manda un **latido** cada 20 segundos mientras está abierta. Cuando
cierras la pestaña dejan de llegar y el servidor se apaga a los **tres
minutos**.

El margen es generoso a propósito: los navegadores frenan los temporizadores de
las pestañas en segundo plano, y apagarse con la pestaña todavía abierta sería
peor que tardar un minuto de más en salir. Además, si vuelves a abrir la app
antes de que se apague, el paso 1 se encarga.

## Cuatro cosas que costó averiguar

Todas dan el mismo síntoma —«no pasa nada»— y ninguna deja rastro a la vista,
así que el script escribe un registro en `$TMPDIR/liga-de-mister.log`.

**`lsof` vive en `/usr/sbin`.** Una app lanzada desde el Finder no hereda el
PATH del Terminal. Sin `/usr/sbin`, la comprobación del puerto devolvía vacío
en silencio, nunca se mataba al servidor anterior, el nuevo no podía arrancar
y el viejo seguía respondiendo: parecía que funcionaba, pero era el de antes.

**`lsof -ti tcp:4788` lista también al navegador.** Cualquier proceso
*conectado* a ese puerto sale ahí, no solo quien escucha. Sin `-sTCP:LISTEN`,
el script mataba Chrome.

**Una alerta sin cerrar cuelga la app para siempre.** `osascript display
alert` bloquea hasta que alguien la cierra, y mientras tanto macOS da la app
por «arrancando»: el siguiente intento muere con un `-1712` incomprensible.
Ahora las alertas se cierran solas a los 30 segundos.

**El servidor no puede colgar de la app.** Si es hijo suyo, macOS la considera
en ejecución y el siguiente doble clic no vuelve a lanzar el script — no pasa
nada de nada, que es peor que un error. Se lanza dentro de un paréntesis para
que, al morir la subshell, quede colgando de launchd.

**Node puede estar en cualquier sitio.** Homebrew, nvm, pnpm, volta, el
instalador oficial… En este Mac estaba en `~/Library/pnpm/bin/node`. Buscarlo a
ciegas es perder el tiempo: la ruta buena la escribe el instalador, que sí
corre en un Terminal con el PATH puesto, y la búsqueda queda solo de plan B.

## Si algo falla

```bash
cat $TMPDIR/liga-de-mister.log
```

Y para verlo todo en directo, sin la app de por medio:

```bash
npm run app
```

## El icono

```bash
npm run icono          # lo redibuja
npm run instalar-app   # lo mete en el bundle
```

`aplicacion/icono.py` lo dibuja con PIL a 4096 px y lo reduce con Lanczos a
cada tamaño; `iconutil` lo empaqueta. No hace falta ningún editor gráfico ni
tener el fichero binario a mano: el icono **es** el script, y cambiarlo es
cambiar cuatro números.

Tres detalles que separan un icono correcto de uno que parece del sistema:

- **La forma no es un rectángulo redondeado.** Desde Big Sur es una
  superelipse: la esquina empieza a curvarse mucho antes. Con
  `rounded_rectangle` se nota al lado de los demás iconos del Dock, así que se
  calcula punto a punto.
- **El símbolo va recortado del escudo**, no encima. Un hueco da cuerpo; un
  símbolo pegado se queda en pegatina.
- **Un filo de luz por dentro del borde superior**, del escudo y de la placa.
  Es lo que hace que parezcan piezas con canto en vez de siluetas planas.

Los colores son los mismos de la app: verde de césped casi negro y el ámbar
del dinero. Comprobado que a 16 px sigue leyéndose el escudo, y a 32 el €.
