/**
 * Noticias de LaLiga publicadas por FútbolFantasy.
 *
 * Solo se conserva lo que la página afirma: fecha, titular, categoría visual y
 * enlace original. No se descarga ni se reescribe el cuerpo y no se infiere si
 * una noticia es buena o mala para un jugador.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const URL = 'https://www.futbolfantasy.com/laliga/noticias'
const SALIDA = join(process.cwd(), 'modulo', 'datos', 'noticias-fantasy.json')

export type NoticiaFantasy = {
  fecha: string
  titulo: string
  url: string
  categoria: string
}

const entidades = (s: string): string => s
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#039;|&apos;/g, "'")
  .replace(/&ntilde;/g, 'ñ')
  .replace(/&Ntilde;/g, 'Ñ')
  .replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í').replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const categoriaDe = (icono: string): string => {
  if (/lesion/i.test(icono)) return 'lesión'
  if (/nodisponible|sanc/i.test(icono)) return 'sanción'
  if (/entreno/i.test(icono)) return 'entrenamiento'
  if (/ruedaprensa/i.test(icono)) return 'rueda de prensa'
  if (/traspaso/i.test(icono)) return 'mercado'
  if (/list/i.test(icono)) return 'convocatoria'
  if (/partido|stats/i.test(icono)) return 'partido'
  if (/descanso/i.test(icono)) return 'equipo'
  return 'análisis'
}

export function parsearNoticias(html: string): NoticiaFantasy[] {
  const noticias: NoticiaFantasy[] = []
  const vistas = new Set<string>()
  const patron = /<div class="noticia">\s*<div class="date">([^<]+)<\/div>\s*<img class="icon" src="([^"]+)"\s*\/?>\s*<a class="link" href="(https:\/\/www\.futbolfantasy\.com\/[^"]+)">([\s\S]*?)<\/a>/g
  for (const m of html.matchAll(patron)) {
    const url = m[3]!
    if (vistas.has(url)) continue
    vistas.add(url)
    noticias.push({
      fecha: entidades(m[1]!),
      titulo: entidades(m[4]!),
      url,
      categoria: categoriaDe(m[2]!),
    })
  }
  return noticias
}

async function main(): Promise<void> {
  const res = await fetch(URL, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; liga-de-mister/1.0)' } })
  if (!res.ok) throw new Error(`FútbolFantasy respondió HTTP ${res.status}`)
  const noticias = parsearNoticias(await res.text()).slice(0, 80)
  if (noticias.length < 10) throw new Error(`solo pude leer ${noticias.length} noticias; la página puede haber cambiado`)
  writeFileSync(SALIDA, `${JSON.stringify({ cuando: new Date().toISOString(), fuente: 'futbolfantasy.com', url: URL, noticias }, null, 1)}\n`)
  process.stderr.write(`${noticias.length} noticias guardadas en ${SALIDA}\n`)
}

if (process.argv[1]?.endsWith('noticiasFantasy.ts')) {
  main().catch((e: unknown) => {
    process.stderr.write(`No pude terminar: ${e instanceof Error ? e.message : 'error desconocido'}\n`)
    process.exit(1)
  })
}
