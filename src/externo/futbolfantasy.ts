/**
 * Quién va a salir de titular, según FútbolFantasy.
 *
 *     npm run probables
 *
 * Mister publica un pronóstico de titularidad, pero es un sí/no y muchas veces
 * viene vacío: los dos porteros de mi plantilla lo tenían a nulo el 7 de
 * septiembre de 2026. FútbolFantasy publica un **porcentaje** por jugador, más
 * quién está sancionado o no disponible, y su `robots.txt` es `Disallow:` vacío
 * —permite todo—.
 *
 * Lo que NO se usa de ahí: sus códigos de lesión (0, 1 y 2). No están
 * documentados y no he podido comprobar qué significa cada uno; inventarme una
 * escala de gravedad sería justo lo que este proyecto no hace. El porcentaje ya
 * lleva dentro esa información: un lesionado serio sale al 0 %.
 *
 * El cruce con los jugadores de Mister es por equipo y nombre, porque no hay un
 * identificador común. Cruza el 94,7 % de los 529; el techo es 96,8 %, que es
 * cuántos publica FútbolFantasy. A quien no cruza no se le inventa nada: se
 * queda sin probabilidad y la página lo dice.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()
const DATOS = join(RAIZ, 'modulo', 'datos')
const SALIDA = join(DATOS, 'probables.json')

/** Los veinte de Primera, de su nombre en la web al id de club en Mister. */
export const CLUBES: Record<string, number> = {
  alaves: 48, athletic: 1, atletico: 2, barcelona: 3, betis: 4, celta: 5,
  deportivo: 6, elche: 23, espanyol: 8, getafe: 9, levante: 12, malaga: 13,
  osasuna: 50, racing: 1490, 'rayo-vallecano': 14, 'real-madrid': 15,
  'real-sociedad': 16, sevilla: 17, valencia: 19, villarreal: 20,
}

/** Un jugador tal y como lo publica FútbolFantasy. */
export type Probable = {
  nombre: string
  idClub: number
  /** Probabilidad de salir de titular, de 0 a 100. */
  probabilidad: number
  sancionado: boolean
  disponible: boolean
  /** Minutos jugados en la temporada, que Mister no publica. */
  minutos: number | null
}

/** Un club desconocido rompe la pasada en vez de dejar un hueco silencioso. */
export class ClubDesconocidoError extends Error {
  constructor(nombre: string) {
    super(`no sé a qué club de Mister corresponde «${nombre}» en FútbolFantasy`)
    this.name = 'ClubDesconocidoError'
  }
}

const entero = (v: string | undefined): number | null => {
  if (v === undefined) return null
  const n = Number(v.replace('%', '').trim())
  return Number.isFinite(n) ? n : null
}

/** Los jugadores de la página de un equipo. */
export function parsearEquipo(html: string, club: string): Probable[] {
  const idClub = CLUBES[club]
  if (idClub === undefined) throw new ClubDesconocidoError(club)

  const salida: Probable[] = []
  const vistos = new Set<string>()
  for (const m of html.matchAll(/class="jugador_(\d+)[^"]*"((?:[^>])*?)>/g)) {
    const atributos = m[2] ?? ''
    if (!atributos.includes('data-probabilidad')) continue
    const d: Record<string, string> = {}
    for (const a of atributos.matchAll(/data-([a-zA-Z0-9_]+)="([^"]*)"/g)) d[a[1]!] = a[2]!

    // El nombre no está en los atributos: va en el `alt` de su camiseta, unos
    // cientos de bytes más abajo dentro del mismo bloque.
    const alt = /alt="([^"]+)"/.exec(html.slice(m.index + m[0].length, m.index + m[0].length + 2500))
    const nombre = alt?.[1]?.trim()
    if (nombre === undefined || nombre === '') continue

    const id = m[1]!
    if (vistos.has(id)) continue
    vistos.add(id)

    salida.push({
      nombre,
      idClub,
      probabilidad: entero(d['probabilidad']) ?? 0,
      sancionado: d['sancionado'] === '1',
      disponible: d['nodisponible'] !== '1',
      minutos: entero(d['totalMinutosJugados']),
    })
  }
  return salida
}

/** Palabras de un nombre, sin tildes ni signos, para poder compararlos. */
export function palabras(nombre: string): string[] {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 1)
}

/**
 * A qué jugador de Mister corresponde cada uno.
 *
 * Solo se compara dentro del mismo club, que es lo que hace fiable un cruce por
 * apellido: «Martínez» a secas no dice nada en LaLiga, pero sí dentro de una
 * plantilla de veinticinco. Si no hay un ganador claro, no se empareja: media
 * probabilidad mal asignada es peor que ninguna.
 */
export function emparejar(
  mios: { id: string; nombre: string; eq: number }[],
  suyos: Probable[],
): Map<string, Probable> {
  const porClub = new Map<number, Probable[]>()
  for (const p of suyos) {
    const l = porClub.get(p.idClub) ?? []
    l.push(p)
    porClub.set(p.idClub, l)
  }

  const salida = new Map<string, Probable>()
  for (const j of mios) {
    const candidatos = porClub.get(j.eq) ?? []
    const mias = new Set(palabras(j.nombre))
    let mejor: Probable | null = null
    let punto = 0
    let empate = false
    for (const c of candidatos) {
      const suyas = new Set(palabras(c.nombre))
      const comunes = [...mias].filter((t) => suyas.has(t)).length
      if (comunes === 0) continue
      const p = comunes / Math.min(mias.size, suyas.size)
      if (p > punto) { mejor = c; punto = p; empate = false } else if (p === punto) empate = true
    }
    if (mejor !== null && punto >= 0.5 && !empate) salida.set(j.id, mejor)
  }
  return salida
}

const paso = (t: string) => process.stderr.write(`${t}\n`)

async function main(): Promise<void> {
  const censo = JSON.parse(readFileSync(join(DATOS, 'jugadores-calc.json'), 'utf8')) as {
    id: string | number
    nombre: string
    eq: number
  }[]

  const suyos: Probable[] = []
  for (const club of Object.keys(CLUBES)) {
    const res = await fetch(`https://www.futbolfantasy.com/laliga/equipos/${club}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; liga-de-mister/1.0)' },
    })
    if (!res.ok) {
      paso(`no pude con ${club}: HTTP ${res.status}`)
      continue
    }
    const leidos = parsearEquipo(await res.text(), club)
    suyos.push(...leidos)
    await new Promise((r) => setTimeout(r, 400))
  }
  paso(`${suyos.length} jugadores leídos de FútbolFantasy`)

  const mios = censo.map((j) => ({ id: String(j.id), nombre: j.nombre, eq: j.eq }))
  const cruce = emparejar(mios, suyos)
  paso(`cruzan ${cruce.size} de ${mios.length} (${((100 * cruce.size) / mios.length).toFixed(1)} %)`)

  const salida = {
    cuando: new Date().toISOString(),
    fuente: 'futbolfantasy.com',
    leidos: suyos.length,
    jugadores: Object.fromEntries(
      [...cruce].map(([id, p]) => [
        id,
        { prob: p.probabilidad, sancionado: p.sancionado ? 1 : 0, fuera: p.disponible ? 0 : 1, min: p.minutos },
      ]),
    ),
  }
  writeFileSync(SALIDA, `${JSON.stringify(salida, null, 1)}\n`)
  const titulares = [...cruce.values()].filter((p) => p.probabilidad >= 70).length
  paso(`${titulares} con 70 % o más de salir de titular · guardado en ${SALIDA}`)
}

if (process.argv[1]?.endsWith('futbolfantasy.ts')) {
  main().catch((e: unknown) => {
    process.stderr.write(`No pude terminar: ${e instanceof Error ? e.message : 'error desconocido'}\n`)
    process.exit(1)
  })
}

