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

/**
 * En la lista de lesionados los equipos no vienen por su nombre en la URL sino
 * por el número de su escudo, que es otro. Comprobados los veinte contra la
 * cabecera de cada bloque de esa página.
 */
export const ESCUDOS_FF: Record<string, number> = {
  '28': 48, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '21': 23, '7': 8, '8': 9,
  '10': 12, '11': 13, '13': 50, '42': 1490, '14': 14, '15': 15, '16': 16, '17': 17,
  '18': 19, '22': 20,
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

/**
 * Una baja: qué tiene y hasta cuándo, tal y como lo escribe FútbolFantasy.
 *
 * El «hasta» se guarda como texto —«finales de septiembre», «2 semanas»— y no
 * se convierte en fecha. Ellos lo publican así porque así de exacto es: un
 * plazo médico aproximado. Traducirlo a un día concreto sería darle una
 * precisión que nadie tiene.
 */
export type Baja = {
  nombre: string
  idClub: number
  /** La lesión, con sus palabras: «Rotura en los isquiotibiales». */
  lesion: string
  /** Desde cuándo, si lo dicen: «16/04 (144 días)». */
  desde: string | null
  /** Cuándo se espera que vuelva: «finales de septiembre». */
  hasta: string | null
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
 * Solo se compara dentro del mismo club, y **el apellido tiene que coincidir**.
 * Sin esa segunda condición, compartir el nombre de pila bastaba: a Unai Simón,
 * que está sano, se le colgaba la rotura de cruzado de Unai Egiluz, y a Nico
 * Williams la baja de Nico Serrano. Los dos del Athletic, los dos «Unai» y
 * «Nico». Una lesión atribuida a quien no la tiene es peor que no decir nada.
 *
 * Y cada jugador de FútbolFantasy se reparte una sola vez: se van asignando de
 * mejor a peor parecido, así que si dos podrían llevárselo se lo queda el que
 * más se parece y el otro se queda sin nada. Ante un empate exacto, ninguno.
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

  // Todas las parejas posibles con su parecido, para poder repartir por orden.
  type Pareja = { id: string; suyo: Probable; punto: number }
  const parejas: Pareja[] = []
  for (const j of mios) {
    const mias = palabras(j.nombre)
    if (mias.length === 0) continue
    const miApellido = mias[mias.length - 1]
    for (const c of porClub.get(j.eq) ?? []) {
      const suyas = palabras(c.nombre)
      if (suyas.length === 0) continue
      // El apellido manda: sin él no hay pareja, por mucho que coincida el resto.
      if (suyas[suyas.length - 1] !== miApellido) continue
      const comunes = mias.filter((t) => suyas.includes(t)).length
      parejas.push({ id: j.id, suyo: c, punto: comunes / Math.max(mias.length, suyas.length) })
    }
  }

  parejas.sort((a, b) => b.punto - a.punto)
  const salida = new Map<string, Probable>()
  const pillados = new Set<Probable>()
  for (let k = 0; k < parejas.length; k += 1) {
    const par = parejas[k]!
    if (salida.has(par.id) || pillados.has(par.suyo)) continue
    // Empate exacto entre dos candidatos distintos: mejor ninguno que el que no es.
    const siguiente = parejas[k + 1]
    if (siguiente !== undefined && siguiente.punto === par.punto && siguiente.id === par.id) {
      k += 1
      continue
    }
    salida.set(par.id, par.suyo)
    pillados.add(par.suyo)
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

  // Las bajas van en su propia página: la de cada equipo dice que alguien está
  // lesionado, pero no cuánto le queda, que es lo que decide si venderle o
  // esperarle.
  let bajas: Baja[] = []
  try {
    const res = await fetch('https://www.futbolfantasy.com/laliga/lesionados', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; liga-de-mister/1.0)' },
    })
    if (res.ok) bajas = parsearLesionados(await res.text())
    else paso(`no pude con los lesionados: HTTP ${res.status}`)
  } catch (e) {
    paso(`no pude con los lesionados: ${e instanceof Error ? e.message : 'error'}`)
  }
  const cruceBajas = emparejar(
    mios,
    bajas.map((b) => ({ nombre: b.nombre, idClub: b.idClub, probabilidad: 0, sancionado: false, disponible: false, minutos: null })),
  )
  const porNombre = new Map(bajas.map((b) => [`${b.idClub}|${b.nombre}`, b]))
  paso(`${bajas.length} lesionados en LaLiga, ${cruceBajas.size} de los tuyos o de tus rivales`)

  const salida = {
    cuando: new Date().toISOString(),
    fuente: 'futbolfantasy.com',
    leidos: suyos.length,
    jugadores: Object.fromEntries(
      [...cruce].map(([id, p]) => {
        const b = cruceBajas.has(id) ? porNombre.get(`${cruceBajas.get(id)!.idClub}|${cruceBajas.get(id)!.nombre}`) : undefined
        return [
          id,
          {
            prob: p.probabilidad,
            sancionado: p.sancionado ? 1 : 0,
            fuera: p.disponible ? 0 : 1,
            min: p.minutos,
            // La baja, con las palabras de FútbolFantasy. `hasta` es un plazo
            // médico aproximado —«finales de septiembre»—, no una fecha.
            ...(b === undefined ? {} : { lesion: b.lesion, desde: b.desde, hasta: b.hasta }),
          },
        ]
      }),
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


/** Quita las etiquetas de un trozo de HTML y deja el texto limpio. */
const soloTexto = (h: string): string =>
  h
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Los lesionados de LaLiga, con hasta cuándo son baja.
 *
 * La página de cada equipo dice que alguien está lesionado, pero no cuánto le
 * queda: eso solo está en la lista de lesionados. Y es justo lo que hace falta
 * para decidir si vender a alguien o esperarle.
 */
export function parsearLesionados(html: string): Baja[] {
  const salida: Baja[] = []
  let club: number | null = null

  // Las filas van agrupadas bajo la cabecera de cada equipo, así que se recorre
  // en orden y se recuerda de quién es el bloque en el que se está.
  for (const m of html.matchAll(
    /<header class="title[^"]*">.*?cabecera\/hd\/(\d+)\.png[^>]*>\s*([^<]*)<\/header>|<div class="elemento lesionado[^"]*">([\s\S]*?)<div class="links/g,
  )) {
    if (m[1] !== undefined) {
      club = ESCUDOS_FF[m[1]] ?? null
      continue
    }
    const bloque = m[3]
    if (bloque === undefined || club === null) continue
    const nombre = /class="jugador"[^>]*>([^<]+)</.exec(bloque)?.[1]?.trim()
    if (nombre === undefined || nombre === '') continue
    const comentario = /<div class="comentario">([\s\S]*?)<\/div>/.exec(bloque)?.[1] ?? ''
    const partes = [...comentario.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map((x) => soloTexto(x[1] ?? ''))
    const hasta = partes.find((t) => /^baja hasta/i.test(t))
    const desde = partes.find((t) => /^desde/i.test(t))
    salida.push({
      nombre,
      idClub: club,
      lesion: partes[0] ?? '',
      desde: desde === undefined ? null : desde.replace(/^desde\s*/i, ''),
      hasta: hasta === undefined ? null : hasta.replace(/^baja hasta\s*/i, ''),
    })
  }
  return salida
}
