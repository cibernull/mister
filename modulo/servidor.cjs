#!/usr/bin/env node
// Servidor local del módulo. Sirve la página y le da al botón «Actualizar»
// algo con lo que hablar: el navegador no puede pedirle nada a Mister por su
// cuenta —ni tiene la cookie, ni le dejaría el navegador—, así que quien va a
// buscar los datos es este proceso.
//
//   node modulo/servidor.cjs
//
// Escucha solo en 127.0.0.1: no se asoma a la red.
'use strict'
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const RAIZ = path.join(__dirname, '..')
const PAGINA = path.join(RAIZ, 'datos', 'mercado.html')
const PUERTO = Number(process.env.PUERTO ?? 4788)

/** Una actualización cada vez: dos a la vez se pisarían los ficheros. */
let enCurso = null

function actualizar() {
  if (enCurso) return enCurso
  enCurso = new Promise((resolve) => {
    const hijo = spawn('npx', ['tsx', 'src/actualizacion/actualizar.ts'], { cwd: RAIZ })
    let salida = ''
    let traza = ''
    hijo.stdout.on('data', (d) => (salida += d))
    hijo.stderr.on('data', (d) => {
      traza += d
      process.stderr.write(d)
    })
    hijo.on('error', (e) =>
      resolve({ ok: false, mensaje: 'No pude lanzar la actualización.', detalle: [e.message] }),
    )
    hijo.on('close', () => {
      try {
        resolve(JSON.parse(salida))
      } catch {
        resolve({
          ok: false,
          mensaje: 'La actualización terminó sin decir qué pasó.',
          detalle: (traza || salida).trim().split('\n').slice(-6),
        })
      }
    })
  }).finally(() => {
    enCurso = null
  })
  return enCurso
}

const json = (res, codigo, cuerpo) => {
  const texto = JSON.stringify(cuerpo)
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(texto) })
  res.end(texto)
}

const servidor = http.createServer((req, res) => {
  const ruta = (req.url ?? '/').split('?')[0]

  if (req.method === 'POST' && ruta === '/actualizar') {
    actualizar().then((r) => json(res, r.ok ? 200 : 500, r))
    return
  }

  if (req.method === 'GET' && (ruta === '/' || ruta === '/mercado.html')) {
    let html
    try {
      html = fs.readFileSync(PAGINA)
    } catch {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Todavía no hay página generada. Ejecuta:  node modulo/generar.cjs')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(html)
    return
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('Aquí no hay nada')
})

servidor.listen(PUERTO, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PUERTO}/`
  console.log(`Módulo de Mister en ${url}`)
  console.log('Ctrl+C para pararlo.')
  spawn('open', [url], { stdio: 'ignore' }).on('error', () => {})
})

servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`El puerto ${PUERTO} ya está ocupado. Prueba:  PUERTO=4789 node modulo/servidor.cjs`)
    process.exit(1)
  }
  throw e
})
