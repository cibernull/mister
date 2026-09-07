/**
 * Las caras: bajar la foto de cada jugador, una vez y para siempre.
 *
 *     npm run fotos
 *
 * Mister sirve la cara de cada jugador en `cdn-common/players/{id}.png`, sin
 * sesión y sin referer: un PNG de 250×250 con el fondo transparente. La URL
 * sale del id, así que no hay nada que guardar ni que parsear —comprobado en
 * seis fichas al azar, cada una trae exactamente una foto y es la suya.
 *
 * No se enlazan desde ahí. Por dos razones:
 *
 *   · pesan 25 KB cada una, y en una lista de cuarenta y ocho caras eso es un
 *     mega y pico de datos del móvil para pintarlas a 24 píxeles;
 *   · y la página dejaría de valerse por sí sola, que es justo lo que se
 *     decidió con los escudos cuando se metieron en base64.
 *
 * Así que se bajan una vez, se reducen a 96 px en webp —2,6 KB, la décima
 * parte— y se quedan en el repo. Una foto no cambia; esta pasada solo trabaja
 * con los que llegan nuevos a la competición.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const RAIZ = process.cwd()
const DATOS = join(RAIZ, 'modulo', 'datos')
const FOTOS = join(RAIZ, 'modulo', 'fotos')

/** De dónde salen. El `?version=` de Mister es un rompecachés y no hace falta. */
const URL_DE = (id: string) => `https://cdn-mister.mundodeportivo.com/file/cdn-common/players/${id}.png`

/** A cuántos píxeles se guardan. 96 basta para el avatar a 48 en pantalla retina. */
export const LADO = 96

/** Cuántas se bajan como mucho de una vez, para que esto no bloquee nada. */
export const MAXIMO_POR_PASADA = 60

/** A quién le falta la cara. */
export function aQuienFaltaFoto(ids: string[], tengo: Set<string>, tope = MAXIMO_POR_PASADA): string[] {
  return ids.filter((id) => !tengo.has(id)).slice(0, tope)
}

const paso = (t: string) => process.stderr.write(`${t}\n`)

async function main(): Promise<void> {
  mkdirSync(FOTOS, { recursive: true })

  const censo = JSON.parse(readFileSync(join(DATOS, 'jugadores-calc.json'), 'utf8')) as { id: string }[]
  const tengo = new Set(
    readdirSync(FOTOS)
      .filter((f) => f.endsWith('.webp'))
      .map((f) => f.replace('.webp', '')),
  )
  const faltan = aQuienFaltaFoto(censo.map((j) => String(j.id)), tengo)

  if (faltan.length === 0) {
    paso(`${censo.length} jugadores y ninguna cara que bajar: todas están.`)
    return
  }
  const total = censo.filter((j) => !tengo.has(String(j.id))).length
  paso(
    `${censo.length} jugadores · ${total} sin cara · bajo ${faltan.length} en esta pasada` +
      (total > faltan.length ? `, las ${total - faltan.length} restantes en las siguientes` : ''),
  )

  const fallidos: string[] = []
  let hechas = 0
  for (const id of faltan) {
    const bruto = join(FOTOS, `${id}.png`)
    try {
      const r = await fetch(URL_DE(id))
      if (!r.ok) throw new Error(`el CDN respondió ${r.status}`)
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length < 1000) throw new Error(`solo ${buf.length} bytes, no parece una foto`)
      writeFileSync(bruto, buf)
      // `-resize LADO 0` mantiene la proporción: si alguna no fuera cuadrada,
      // preferimos que salga más baja a que salga aplastada.
      execFileSync('cwebp', ['-quiet', '-q', '82', '-resize', String(LADO), '0', bruto, '-o', join(FOTOS, `${id}.webp`)])
      hechas += 1
    } catch (e) {
      fallidos.push(`${id}: ${e instanceof Error ? e.message : 'error'}`)
    } finally {
      if (existsSync(bruto)) unlinkSync(bruto)
    }
  }

  paso(`Listo: ${hechas} caras nuevas, ${tengo.size + hechas} en total.`)
  if (fallidos.length > 0) paso(`No pude con ${fallidos.length}:\n  ${fallidos.join('\n  ')}`)
}

if (process.argv[1]?.endsWith('fotos.ts')) {
  main().catch((e: unknown) => {
    process.stderr.write(`No pude terminar: ${e instanceof Error ? e.message : 'error desconocido'}\n`)
    process.exit(1)
  })
}
