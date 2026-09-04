/**
 * Guarda las credenciales de la sesión a partir de un «Copy as cURL».
 *
 *   npm run credenciales            desde el Terminal, pegando en la entrada
 *   tsx src/sesion/importar.ts --json        lo mismo, pero contestando JSON
 *   tsx src/sesion/importar.ts --comprobar --json   solo mira si las de disco valen
 *
 * Las dos credenciales que Mister exige —la cookie de sesión y el token
 * `X-Auth`— viajan juntas en la cabecera de cualquier petición del navegador.
 * Chrome sabe copiar una petición entera como comando cURL, así que con un
 * clic derecho y un pegado están las dos, en vez de ir a buscarlas por
 * separado.
 *
 * No hay forma de sacarlas por código: la cuenta entra con Apple y la cookie
 * es HttpOnly, de modo que ni el JavaScript de la página la ve. Tienen que
 * pasar por aquí.
 *
 * Los valores no se imprimen nunca, ni siquiera en los errores, y los ficheros
 * se escriben solo para el usuario (0600) dentro de `.sesion/`, que está en
 * .gitignore.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { obtenerCredenciales } from './credenciales.js'

const DIR = () => join(process.cwd(), '.sesion')
const FEED = 'https://mister.mundodeportivo.com/ajax/feed'

export type Resultado = {
  ok: boolean
  /** 'faltan' | 'caducadas' | 'ilegible' | 'mister' — para saber qué enseñar. */
  causa?: 'faltan' | 'caducadas' | 'ilegible' | 'mister'
  mensaje: string
  detalle?: string[]
}

export const PASOS = [
  'En Chrome, con Mister abierto y tu sesión iniciada, abre las herramientas con ⌥⌘I.',
  'Ve a la pestaña Red (Network) y escribe ajax en el cuadro Filtrar.',
  'Si no sale nada, baja por la lista de Actividad de Mister hasta que cargue más: eso dispara la petición.',
  'Clic derecho sobre cualquiera de las que salgan («balance», «feed»…) → Copy → Copy as cURL.',
  'Pega aquí lo copiado.',
]

/**
 * Saca el valor de una cabecera de lo que sea que se haya pegado.
 *
 * Se aceptan las dos formas en que Chrome las enseña, porque dar con la
 * petición correcta ya cuesta bastante como para además fallar por haber
 * copiado del sitio de al lado:
 *
 *     -H 'cookie: …'    del «Copy as cURL». Entrecomilla con ' en Mac y Linux
 *                       y con " en Windows, y escapa las comillas internas
 *                       de dentro como '\''
 *     cookie: …         una línea suelta, tal como se lee en Request Headers
 *
 * Equivocarse aquí significaría guardar una credencial truncada, que falla más
 * tarde y de forma confusa.
 */
export function extraerCabecera(pegado: string, nombre: string): string | null {
  const escapado = nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const entrecomillada = new RegExp(`-H\\s+(['"])${escapado}:\\s*([\\s\\S]*?)\\1(?=\\s|$)`, 'i')
  const m = entrecomillada.exec(pegado)
  if (m) return limpiar(m[2]!)

  // Una línea suelta termina donde termina la línea: ni la cookie ni el token
  // llevan saltos dentro.
  const suelta = new RegExp(`^[ \\t]*${escapado}:[ \\t]*(\\S.*)$`, 'im')
  const n = suelta.exec(pegado)
  return n ? limpiar(n[1]!) : null
}

function limpiar(valor: string): string | null {
  const v = valor.replace(/'\\''/g, "'").trim()
  return v === '' ? null : v
}

/** Pregunta a Mister si un par de credenciales sirve todavía. */
async function sirven(cookie: string, auth: string): Promise<Resultado> {
  let res: Response
  try {
    res = await fetch(FEED, {
      method: 'POST',
      headers: {
        cookie,
        'x-auth': auth,
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
      },
      body: 'offset=0&cardsPerPage=1&end=0&loading=0',
    })
  } catch (e) {
    return {
      ok: false,
      causa: 'mister',
      mensaje: 'No he podido hablar con Mister.',
      detalle: [e instanceof Error ? e.message : 'error de red', '¿Hay conexión?'],
    }
  }

  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      causa: 'caducadas',
      mensaje: 'Mister no acepta esa sesión.',
      detalle: [
        'Suele ser que la del navegador ya no vale.',
        'Entra otra vez en Mister, recarga, y vuelve a copiar la petición.',
      ],
    }
  }
  if (!res.ok) {
    return { ok: false, causa: 'mister', mensaje: `Mister respondió ${res.status}.`, detalle: ['Prueba dentro de un rato.'] }
  }
  return { ok: true, mensaje: 'La sesión funciona.' }
}

/** Comprueba las credenciales que ya están en disco, sin tocarlas. */
export async function comprobarGuardadas(): Promise<Resultado> {
  let cred
  try {
    cred = obtenerCredenciales(DIR())
  } catch {
    return { ok: false, causa: 'faltan', mensaje: 'Todavía no me has dado la sesión de Mister.' }
  }
  return sirven(cred.cookie, cred.auth)
}

/**
 * Lee las dos cabeceras del pegado, las prueba y solo entonces las guarda.
 *
 * Probar antes de guardar importa: unas credenciales caducadas guardadas solo
 * cambian el error de sitio, y encima pisan unas que quizá sí valían.
 */
export async function importarDesdeCurl(pegado: string): Promise<Resultado> {
  if (pegado.trim() === '') {
    return { ok: false, causa: 'ilegible', mensaje: 'No has pegado nada.', detalle: PASOS }
  }

  const cookie = extraerCabecera(pegado, 'cookie')
  const auth = extraerCabecera(pegado, 'x-auth')
  if (!cookie || !auth) {
    const faltan = [!cookie && 'la cookie', !auth && 'el token X-Auth'].filter(Boolean).join(' y ')
    return {
      ok: false,
      causa: 'ilegible',
      mensaje: `En lo que has pegado no encuentro ${faltan}.`,
      detalle: [
        'Las imágenes, la analítica y la propia página no llevan esas dos cabeceras juntas:',
        'solo las llamadas a /ajax/ de Mister. Filtra por «ajax» en la pestaña Red.',
        'También vale pegar directamente las dos líneas de Request Headers.',
      ],
    }
  }

  const veredicto = await sirven(cookie, auth)
  if (!veredicto.ok) return veredicto

  mkdirSync(DIR(), { recursive: true })
  writeFileSync(join(DIR(), 'cookie'), cookie, { mode: 0o600 })
  writeFileSync(join(DIR(), 'auth'), auth, { mode: 0o600 })

  return {
    ok: true,
    mensaje: 'Sesión guardada y funcionando.',
    detalle: ['Queda en .sesion/, que git ignora, y no sale de este ordenador.'],
  }
}

// ── Modo Terminal ────────────────────────────────────────────────────────────

async function leerEntrada(): Promise<string> {
  const trozos: Buffer[] = []
  for await (const t of process.stdin) trozos.push(Buffer.from(t))
  return Buffer.concat(trozos).toString('utf8')
}

async function main(): Promise<number> {
  const json = process.argv.includes('--json')
  const soloComprobar = process.argv.includes('--comprobar')

  let r: Resultado
  if (soloComprobar) {
    r = await comprobarGuardadas()
  } else {
    if (process.stdin.isTTY && !json) {
      process.stdout.write(
        `${PASOS.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}\n\nPega aquí el comando cURL, luego Enter y Ctrl+D:\n`,
      )
    }
    r = await importarDesdeCurl(await leerEntrada())
  }

  if (json) {
    process.stdout.write(JSON.stringify(r))
  } else {
    const salida = r.ok ? process.stdout : process.stderr
    salida.write(`${r.mensaje}\n${(r.detalle ?? []).map((d) => `  ${d}`).join('\n')}\n`)
  }
  return r.ok ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (c) => process.exit(c),
    (e: unknown) => {
      // Nada de volcar el error entero: el pegado lleva las credenciales dentro.
      process.stderr.write(`No pude terminar: ${e instanceof Error ? e.message : 'error desconocido'}\n`)
      process.exit(1)
    },
  )
}
