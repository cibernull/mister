/**
 * El lanzador: lo único que puede pedirle a GitHub que actualice la liga.
 *
 * La página está publicada en GitHub Pages, que es hosting estático: no hay
 * nada detrás que pueda hablar con la API de GitHub. Y meter el token en la
 * página no es una opción — es pública, se leería con ver el código fuente.
 *
 * Así que el token vive aquí, en un secreto de Cloudflare que no sale nunca al
 * exterior. La página pide «actualiza» sin credencial ninguna, y este programa
 * decide si la lanza. Lo peor que puede hacer un desconocido que encuentre la
 * dirección es refrescar los datos de Isaac, que es justo lo que el botón hace
 * de todos modos; por eso no hay contraseña, solo un freno para que nadie la
 * dispare en bucle.
 *
 * Hace dos cosas:
 *   fetch      responde al botón de la página
 *   scheduled  lanza la actualización sola, con el cron de Cloudflare, que es
 *              bastante más puntual que el de GitHub Actions
 */

const REPO = 'cibernull/mister'
const WORKFLOW = 'actualizar.yml'
const RAMA = 'main'

// Solo la página de la liga puede llamar desde el navegador. No es seguridad
// de verdad —cualquiera puede hacer la misma petición con curl— pero evita que
// una web ajena ponga un botón que dispare esto sin que nadie se entere.
const ORIGENES = ['https://cibernull.github.io']

// Dos pasadas seguidas no sirven de nada: la anterior acaba de leer Mister.
const FRENO_MS = 4 * 60 * 1000

const GH = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  // GitHub rechaza las peticiones sin User-Agent. No es opcional.
  'User-Agent': 'liga-de-mister-lanzador',
}

async function github(env, ruta, init = {}) {
  return fetch(`https://api.github.com/repos/${REPO}${ruta}`, {
    ...init,
    headers: { ...GH, Authorization: `Bearer ${env.GITHUB_TOKEN}`, ...(init.headers || {}) },
  })
}

/**
 * ¿Conviene lanzar otra, o hay una recién hecha?
 *
 * El freno se resuelve preguntándole a GitHub por la última pasada en vez de
 * guardando aquí la hora de la anterior: un Worker no tiene memoria entre
 * peticiones —cada una puede caer en una máquina distinta del mundo— así que
 * cualquier contador propio sería mentira. GitHub sí lo sabe con exactitud.
 */
async function estadoUltima(env) {
  const res = await github(env, `/actions/workflows/${WORKFLOW}/runs?per_page=1`)
  if (!res.ok) return { conocido: false }

  const { workflow_runs: runs } = await res.json()
  const ultima = runs && runs[0]
  if (!ultima) return { conocido: true, enMarcha: false, haceMs: Infinity }

  return {
    conocido: true,
    enMarcha: ultima.status !== 'completed',
    haceMs: Date.now() - Date.parse(ultima.created_at),
  }
}

async function lanzar(env, { respetarFreno }) {
  const ultima = await estadoUltima(env)

  if (ultima.conocido && ultima.enMarcha) {
    return { estado: 'en-marcha', mensaje: 'Ya hay una actualización en marcha.' }
  }
  if (respetarFreno && ultima.conocido && ultima.haceMs < FRENO_MS) {
    const faltan = Math.ceil((FRENO_MS - ultima.haceMs) / 60000)
    return { estado: 'reciente', mensaje: `Acaba de actualizarse. Vuelve a intentarlo en ${faltan} min.` }
  }

  const res = await github(env, `/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: RAMA }),
  })

  // 204 sin cuerpo es el «hecho» de esta llamada.
  if (res.status === 204) return { estado: 'lanzada', mensaje: 'Actualización lanzada. Tarda un minuto.' }

  // El cuerpo del error de GitHub no lleva el token, pero sí puede llevar
  // detalles del repositorio; se resume en vez de reenviarlo entero.
  const motivo = res.status === 401 || res.status === 403
    ? 'El token del lanzador no vale o ha caducado.'
    : `GitHub respondió ${res.status}.`
  return { estado: 'error', mensaje: motivo }
}

function cabecerasCors(origen) {
  const permitido = ORIGENES.includes(origen) ? origen : ORIGENES[0]
  return {
    'Access-Control-Allow-Origin': permitido,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

export default {
  async fetch(peticion, env) {
    const cors = cabecerasCors(peticion.headers.get('Origin') || '')

    if (peticion.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (peticion.method !== 'POST') {
      return Response.json({ estado: 'error', mensaje: 'Usa POST.' }, { status: 405, headers: cors })
    }
    if (!env.GITHUB_TOKEN) {
      return Response.json(
        { estado: 'error', mensaje: 'Al lanzador le falta el secreto GITHUB_TOKEN.' },
        { status: 500, headers: cors },
      )
    }

    const r = await lanzar(env, { respetarFreno: true })
    return Response.json(r, { headers: cors })
  },

  // El reloj propio. GitHub Actions se salta slots cuando va cargado —de hecho
  // se saltó el primero de esta liga— y el de Cloudflare no.
  async scheduled(_evento, env, ctx) {
    ctx.waitUntil(lanzar(env, { respetarFreno: false }))
  },
}
