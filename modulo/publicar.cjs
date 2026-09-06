#!/usr/bin/env node
// Prepara la página para publicarla en la web.
//
//   node modulo/publicar.cjs [salida.html]
//
// La página que sirve el servidor es un documento entero, y quien la publica
// la envuelve por su cuenta: hay que entregarle solo el contenido, con el
// <title> y el <style> delante.
//
// Además, ahí fuera no hay servidor local. El botón de actualizar apunta a
// `/actualizar` y el latido a `/latido`, así que sin desactivarlos la página
// enseñaría un botón que solo sabe fallar. `window.PUBLICADO` lo apaga todo y
// deja en su sitio la fecha de los datos, que es lo que hace falta saber
// cuando se mira esto desde el móvil.
'use strict'
const fs = require('fs')
const path = require('path')

const ENTRADA = path.join(__dirname, '..', 'datos', 'mercado.html')
const SALIDA = process.argv[2] || path.join(__dirname, '..', 'datos', 'publicada.html')
/** La misma página, pero como documento entero, para servirla en un sitio web. */
const SITIO = path.join(__dirname, '..', 'datos', 'sitio', 'index.html')

const doc = fs.readFileSync(ENTRADA, 'utf8')

const trozo = (etiqueta) => {
  const m = new RegExp(`<${etiqueta}[^>]*>[\\s\\S]*?</${etiqueta}>`, 'i').exec(doc)
  if (!m) throw new Error(`la página no tiene <${etiqueta}>`)
  return m[0]
}

const cuerpo = /<body[^>]*>([\s\S]*)<\/body>/i.exec(doc)
if (!cuerpo) throw new Error('la página no tiene <body>')

// Las tipografías se sirven desde Google Fonts, que es de los pocos sitios que
// el visor deja cargar. El resto ya va todo dentro.
const fuentes = /<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^"]*">/.exec(doc)

const cuando = new Date().toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' })
const marca =
  `<script>window.PUBLICADO=true;window.PUBLICADO_CUANDO=${JSON.stringify(cuando)}</script>`

fs.writeFileSync(
  SALIDA,
  [trozo('title'), fuentes ? fuentes[0] : '', trozo('style'), marca, cuerpo[1]].join('\n'),
)

// Y la versión para GitHub Pages, que sí necesita el documento completo. Se
// le mete la misma marca `window.PUBLICADO`: allí tampoco hay servidor local
// al que pedirle nada, así que el botón tiene que ser Recargar y no Actualizar.
fs.mkdirSync(path.dirname(SITIO), { recursive: true })
fs.writeFileSync(SITIO, doc.replace('</head>', `${marca}\n</head>`))

// Un fichero de veinte bytes con la misma fecha que lleva la página dentro.
// Existe para que, tras pulsar «Actualizar», el móvil pueda preguntar «¿ya?»
// cada diez segundos sin bajarse el mega y pico de la página entera cada vez.
// Se saca del documento ya construido, no de otro `new Date()`, para que las
// dos fechas no puedan discrepar ni por un segundo.
const generado = /data-generado="([^"]*)"/.exec(doc)
if (!generado) throw new Error('la página no lleva data-generado')
fs.writeFileSync(path.join(path.dirname(SITIO), 'cuando.txt'), generado[1])

const kb = Math.round(fs.statSync(SALIDA).size / 1024)
process.stdout.write(`${SALIDA}\n${SITIO}\n${kb} KB · datos del ${cuando}\n`)
