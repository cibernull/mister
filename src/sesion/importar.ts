/**
 * Guarda las credenciales de la sesión a partir de un «Copy as cURL».
 *
 * Uso:  npm run credenciales
 *
 * Las dos credenciales que Mister exige —la cookie de sesión y el token
 * `X-Auth`— viajan juntas en la cabecera de cualquier petición del navegador.
 * Chrome sabe copiar una petición entera como comando cURL, así que con un
 * clic derecho y un pegado están las dos, en vez de ir a buscarlas por
 * separado.
 *
 * No hay forma de sacarlas por código: la cuenta entra con Apple y la cookie
 * es HttpOnly, de modo que ni el JavaScript de la página la ve. Tiene que
 * pasar por aquí.
 *
 * Los valores no se imprimen nunca, ni siquiera en los errores, y los ficheros
 * se escriben solo para el usuario (0600) dentro de `.sesion/`, que está en
 * .gitignore.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const DIR = join(process.cwd(), '.sesion')
const FEED = 'https://mister.mundodeportivo.com/ajax/feed'

/**
 * Saca el valor de una cabecera de un comando cURL pegado.
 *
 * Chrome entrecomilla con `'` en Mac y Linux y con `"` en Windows, y escapa
 * las comillas internas como `'\''`. Se aceptan las dos formas: equivocarse
 * aquí significaría guardar una credencial truncada, que falla luego y de
 * forma confusa.
 */
export function extraerCabecera(curl: string, nombre: string): string | null {
  const escapado = nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`-H\\s+(['"])${escapado}:\\s*([\\s\\S]*?)\\1(?=\\s|$)`, 'i')
  const m = re.exec(curl)
  if (!m) return null
  const valor = m[2]!.replace(/'\\''/g, "'").trim()
  return valor === '' ? null : valor
}

async function leerEntrada(): Promise<string> {
  const trozos: Buffer[] = []
  for await (const t of process.stdin) trozos.push(Buffer.from(t))
  return Buffer.concat(trozos).toString('utf8')
}

function instrucciones(): string {
  return [
    'Cómo conseguir el pegado, en Chrome y con Mister abierto:',
    '',
    '  1. Abre las herramientas de desarrollo:  ⌥⌘I',
    '  2. Pestaña  Network  (Red). Recarga la página con ⌘R.',
    '  3. Clic derecho sobre cualquier petición de la lista',
    '     →  Copy  →  Copy as cURL',
    '  4. Vuelve aquí y pega (⌘V), luego Enter y Ctrl+D.',
    '',
    'De ahí salen las dos credenciales de golpe. No se imprimen en ningún sitio',
    'y quedan en .sesion/, que git ignora.',
  ].join('\n')
}

async function main(): Promise<number> {
  if (process.stdin.isTTY) {
    process.stdout.write(`${instrucciones()}\n\nPega aquí el comando cURL:\n`)
  }

  const pegado = await leerEntrada()
  if (pegado.trim() === '') {
    process.stderr.write(`No has pegado nada.\n\n${instrucciones()}\n`)
    return 1
  }

  const cookie = extraerCabecera(pegado, 'cookie')
  const auth = extraerCabecera(pegado, 'x-auth')

  if (!cookie || !auth) {
    const faltan = [!cookie && 'la cookie', !auth && 'el token X-Auth'].filter(Boolean).join(' y ')
    process.stderr.write(
      `En lo que has pegado no encuentro ${faltan}.\n\n` +
        'Asegúrate de copiar como cURL una petición hecha con la sesión iniciada:\n' +
        'las peticiones a imágenes o a CDNs no llevan estas cabeceras. Una que vaya\n' +
        `a mister.mundodeportivo.com sirve.\n\n${instrucciones()}\n`,
    )
    return 1
  }

  // Antes de guardar nada, probar que sirven. Guardar unas credenciales
  // caducadas solo cambia el error de sitio.
  process.stdout.write('Probándolas contra Mister…\n')
  const res = await fetch(FEED, {
    method: 'POST',
    headers: {
      cookie,
      'x-auth': auth,
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'x-requested-with': 'XMLHttpRequest',
    },
    body: 'offset=0&cardsPerPage=1&end=0&loading=0',
  })

  if (res.status === 401 || res.status === 403) {
    process.stderr.write(
      `Mister las rechaza (${res.status}). Suele ser que la sesión del navegador ya no vale:\n` +
        'entra de nuevo en Mister, recarga, y vuelve a copiar la petición.\n',
    )
    return 1
  }
  if (!res.ok) {
    process.stderr.write(`Mister respondió ${res.status}. No guardo nada hasta saber que funcionan.\n`)
    return 1
  }

  mkdirSync(DIR, { recursive: true })
  writeFileSync(join(DIR, 'cookie'), cookie, { mode: 0o600 })
  writeFileSync(join(DIR, 'auth'), auth, { mode: 0o600 })

  process.stdout.write(
    'Listo. Las dos credenciales quedan guardadas en .sesion/ y funcionan.\n' +
      'Ya puedes darle a Actualizar en la app.\n',
  )
  return 0
}

// Solo al ejecutarlo como script. Si no, importar el módulo —lo hacen las
// pruebas— se pondría a leer stdin y a llamar a process.exit.
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
