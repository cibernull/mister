#!/usr/bin/env node
// Servidor local del módulo.
//
//   npm run app
//
// Sirve la página y le da al botón «Actualizar» algo con lo que hablar: el
// navegador no puede pedirle nada a Mister por su cuenta —ni tiene la cookie,
// ni se lo permitiría—, así que quien va a buscar los datos es este proceso.
//
// Si al arrancar no hay sesión guardada, o la guardada ya no vale, lo primero
// que se ve es la pantalla para pegarla. Antes había que salir al Terminal.
//
// Escucha solo en 127.0.0.1: no se asoma a la red.
'use strict'
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const RAIZ = path.join(__dirname, '..')
const PAGINA = path.join(RAIZ, 'datos', 'mercado.html')
const ALTA = path.join(__dirname, 'credenciales.html')
const PUERTO = Number(process.env.PUERTO ?? 4788)
/** Un pegado de cURL ronda los 3 KB; 256 KB es holgura de sobra. */
const MAX_CUERPO = 256 * 1024

/**
 * Apagarse solo cuando ya no hay nadie mirando.
 *
 * Lanzado desde la app de /Applications no hay Terminal donde hacer Ctrl+C, y
 * dejar el proceso vivo para siempre acaba en «el puerto ya está ocupado». La
 * página manda un latido mientras está abierta; si deja de llegar, esto se
 * apaga. El margen es generoso a propósito: los navegadores frenan los
 * temporizadores de las pestañas que están en segundo plano, y apagarse con la
 * pestaña todavía abierta sería peor que tardar un minuto de más en salir.
 */
const AUTOCERRAR = process.argv.includes('--autocerrar')
const SIN_LATIDO_MS = 3 * 60 * 1000
let ultimoLatido = Date.now()

if (AUTOCERRAR) {
  setInterval(() => {
    if (Date.now() - ultimoLatido < SIN_LATIDO_MS) return
    console.log('Nadie mirando desde hace un rato. Cierro.')
    process.exit(0)
  }, 15000).unref()
}

/** Lo último que se sabe de la sesión. Se refresca al arrancar y tras cada uso. */
let sesion = { ok: false, causa: 'faltan' }
/** Una actualización cada vez: dos a la vez se pisarían los ficheros. */
let enCurso = null

/**
 * Lanza un script del proyecto y devuelve su JSON.
 *
 * Se hace por proceso aparte y no importando el módulo porque el servidor es
 * CommonJS y la lógica vive en TypeScript. El coste es un arranque de tsx, que
 * en una herramienta local no se nota.
 */
function correr(args, entrada) {
  return new Promise((resolve) => {
    const hijo = spawn('npx', ['tsx', ...args], { cwd: RAIZ })
    let salida = ''
    let traza = ''
    hijo.stdout.on('data', (d) => (salida += d))
    hijo.stderr.on('data', (d) => {
      traza += d
      process.stderr.write(d)
    })
    hijo.on('error', (e) => resolve({ ok: false, mensaje: 'No pude lanzar el proceso.', detalle: [e.message] }))
    hijo.on('close', () => {
      try {
        resolve(JSON.parse(salida))
      } catch {
        resolve({
          ok: false,
          mensaje: 'El proceso terminó sin decir qué pasó.',
          detalle: (traza || salida).trim().split('\n').slice(-6),
        })
      }
    })
    if (entrada !== undefined) hijo.stdin.end(entrada)
    else hijo.stdin.end()
  })
}

const comprobarSesion = () =>
  correr(['src/sesion/importar.ts', '--comprobar', '--json']).then((r) => {
    sesion = r
    return r
  })

function actualizar() {
  if (enCurso) return enCurso
  enCurso = correr(['src/actualizacion/actualizar.ts'])
    .then((r) => {
      // Un rechazo de Mister a media pasada significa sesión caducada: que la
      // próxima carga lleve derecho a repegarla en vez de fallar otra vez.
      if (!r.ok && /401|403|sesión|credencial/i.test(JSON.stringify(r))) sesion = { ok: false, causa: 'caducadas' }
      return r
    })
    .finally(() => {
      enCurso = null
    })
  return enCurso
}

const json = (res, codigo, cuerpo) => {
  const texto = JSON.stringify(cuerpo)
  res.writeHead(codigo, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(texto),
    'cache-control': 'no-store',
  })
  res.end(texto)
}

const archivo = (res, ruta, sino) => {
  let cuerpo
  try {
    cuerpo = fs.readFileSync(ruta)
  } catch {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(sino)
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(cuerpo)
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let datos = ''
    req.on('data', (t) => {
      datos += t
      if (datos.length > MAX_CUERPO) {
        req.destroy()
        reject(new Error('el pegado es demasiado grande'))
      }
    })
    req.on('end', () => resolve(datos))
    req.on('error', reject)
  })
}

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PUERTO}`)
  const ruta = url.pathname

  if (req.method === 'POST' && ruta === '/credenciales') {
    leerCuerpo(req)
      .then((cuerpo) => correr(['src/sesion/importar.ts', '--json'], cuerpo))
      .then((r) => {
        if (r.ok) sesion = { ok: true }
        json(res, r.ok ? 200 : 400, r)
      })
      .catch((e) => json(res, 413, { ok: false, mensaje: e.message }))
    return
  }

  if (req.method === 'POST' && ruta === '/latido') {
    ultimoLatido = Date.now()
    res.writeHead(204, { 'cache-control': 'no-store' })
    res.end()
    return
  }

  if (req.method === 'POST' && ruta === '/actualizar') {
    actualizar().then((r) => json(res, r.ok ? 200 : 500, r))
    return
  }

  if (req.method === 'GET' && ruta === '/estado') {
    json(res, 200, sesion)
    return
  }

  if (req.method === 'GET' && ruta === '/credenciales') {
    archivo(res, ALTA, 'Falta modulo/credenciales.html')
    return
  }

  if (req.method === 'GET' && (ruta === '/' || ruta === '/mercado.html')) {
    // Sin sesión, lo primero es pedirla. `?saltar=1` deja ver igualmente los
    // datos de la última actualización buena: tenerlos viejos es mejor que no
    // poder mirarlos.
    if (!sesion.ok && url.searchParams.get('saltar') !== '1' && ruta === '/') {
      archivo(res, ALTA, 'Falta modulo/credenciales.html')
      return
    }
    archivo(res, PAGINA, 'Todavía no hay página generada. Ejecuta:  npm run generar')
    return
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('Aquí no hay nada')
})

servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`El puerto ${PUERTO} ya está ocupado. Prueba:  PUERTO=4789 npm run app`)
    process.exit(1)
  }
  throw e
})

servidor.listen(PUERTO, '127.0.0.1', async () => {
  ultimoLatido = Date.now()
  const url = `http://127.0.0.1:${PUERTO}/`
  console.log(`Módulo de Mister en ${url}`)
  process.stdout.write('Mirando si la sesión de Mister sigue valiendo… ')
  await comprobarSesion()
  console.log(sesion.ok ? 'sí.' : `no: ${sesion.mensaje ?? sesion.causa}`)
  if (!sesion.ok) console.log('Se abrirá la pantalla para pegarla.')
  console.log(AUTOCERRAR ? 'Se cierra solo al cerrar la pestaña.' : 'Ctrl+C para parar.')
  // Lanzado desde la app, quien abre el navegador es el script del bundle:
  // hacerlo también aquí abriría dos pestañas.
  if (!process.argv.includes('--sin-abrir')) spawn('open', [url], { stdio: 'ignore' }).on('error', () => {})
})
