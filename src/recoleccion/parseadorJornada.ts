/**
 * La alineación de una jornada: quién jugó, dónde y cuántos puntos hizo.
 *
 * Sale de `/ajax/sw/gameweek`, que devuelve el once por líneas, el banquillo y
 * los puntos del equipo esa jornada. Es lo único que cuenta qué pusiste de
 * verdad: el once que calcula esta aplicación es una recomendación de hoy, y no
 * dice nada de lo que alineaste hace tres semanas.
 */

/** Un jugador dentro de una alineación pasada. */
export type JugadorAlineado = {
  id: string
  nombre: string
  puesto: number
  puntos: number | null
  /** Si Mister lo dio por jugado; un `0` jugado no es lo mismo que no jugar. */
  jugo: boolean
  capitan: boolean
}

/** Lo que se guarda de cada jornada disputada. */
export type AlineacionJornada = {
  jornada: number
  idJornada: number
  puntos: number | null
  puesto: number | null
  formacion: string
  once: JugadorAlineado[]
  banquillo: JugadorAlineado[]
}

/** Las jornadas que Mister conoce, con su id interno y en qué estado están. */
export type JornadaConocida = { jornada: number; id: number; estado: string }

/**
 * Lo que le pasó a un jugador en un partido, con el minuto.
 *
 * `categoria` viene tal cual de Mister: `goal`, `assist`, `yellow`, `red`,
 * `penalty`, `missed_penalty`, `saved_penalty`, `own_goal`, `sub_in`, `sub_out`.
 * No se traduce aquí para que si aparece una nueva no se pierda por el camino.
 */
export type EventoConMinuto = { categoria: string; minuto: number }

const texto = (v: unknown): string => (typeof v === 'string' ? v : '')
const entero = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function leerJugador(x: unknown): JugadorAlineado | null {
  if (x === null || typeof x !== 'object') return null
  const j = x as Record<string, unknown>
  const id = entero(j['id'])
  if (id === null) return null
  return {
    id: String(id),
    nombre: texto(j['name']),
    puesto: entero(j['position']) ?? 0,
    puntos: entero(j['points']),
    // `played` viene 1/0 y `match_status` dice si el partido llegó a jugarse.
    jugo: j['played'] === 1 || j['played'] === true,
    capitan: j['captain'] === 1 || j['captain'] === true,
  }
}

/** Las jornadas que existen, para saber qué id pedir de cada una. */
export function parsearJornadasConocidas(json: string): JornadaConocida[] {
  const d = (JSON.parse(json) as { data?: { gameweeks?: unknown[] } }).data
  if (!Array.isArray(d?.gameweeks)) throw new Error('la respuesta no trae `data.gameweeks`')
  return d.gameweeks
    .map((x) => {
      const g = x as Record<string, unknown>
      const jornada = entero(g['gameweek'])
      const id = entero(g['id'])
      return jornada === null || id === null ? null : { jornada, id, estado: texto(g['status']) }
    })
    .filter((x): x is JornadaConocida => x !== null)
}

/**
 * La alineación de una jornada.
 *
 * El once llega como `positions`, un objeto de líneas y dentro otro de huecos.
 * Se aplana en orden de puesto, que es como se pinta un campo, y la formación
 * sale de contar cuántos hay en cada línea: Mister no la publica por jornada.
 */
export function parsearAlineacion(json: string, jornada: number, idJornada: number): AlineacionJornada {
  const d = (JSON.parse(json) as { data?: Record<string, unknown> }).data
  if (d === undefined) throw new Error('la respuesta de la jornada no trae `data`')

  const lineup = d['lineup'] as { positions?: Record<string, Record<string, unknown>> } | undefined
  const posiciones = lineup?.positions ?? {}
  const once: JugadorAlineado[] = []
  const porLinea: number[] = []
  for (const clave of Object.keys(posiciones).sort((a, b) => Number(a) - Number(b))) {
    const linea = posiciones[clave] ?? {}
    const gente = Object.keys(linea)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => leerJugador(linea[k]))
      .filter((x): x is JugadorAlineado => x !== null)
    porLinea.push(gente.length)
    once.push(...gente)
  }

  const banquillo = (Array.isArray(d['bench']) ? d['bench'] : [])
    .map(leerJugador)
    .filter((x): x is JugadorAlineado => x !== null)

  const usuario = d['gameweek_user'] as Record<string, unknown> | undefined

  return {
    jornada,
    idJornada,
    puntos: entero(usuario?.['points']),
    puesto: entero(usuario?.['rank']),
    formacion: porLinea.join('-'),
    once,
    banquillo,
  }
}

/**
 * Los eventos de todos los jugadores en una jornada, con su minuto.
 *
 * La ficha de un jugador pinta los iconos de cada jornada pero **no dice el
 * minuto**: ni cuándo entró, ni cuándo salió, ni cuándo marcó. Aquí sí está, y
 * además con categorías que la ficha no distingue —roja, gol en propia,
 * penalti fallado—. De 251 eventos leídos, los 251 traían minuto.
 *
 * Vienen dentro de `players`, agrupados por partido y luego por posición, así
 * que hay que bajar dos niveles antes de encontrar a nadie.
 */
export function parsearEventosDeJornada(json: string): Map<string, EventoConMinuto[]> {
  const d = (JSON.parse(json) as { data?: { players?: Record<string, unknown> } }).data
  const salida = new Map<string, EventoConMinuto[]>()
  const partidos = d?.players
  if (partidos === undefined || partidos === null) return salida

  for (const partido of Object.values(partidos)) {
    const todos = (partido as { all?: unknown }).all
    if (todos === undefined || todos === null) continue
    const grupos = Array.isArray(todos) ? [todos] : Object.values(todos as Record<string, unknown>)
    for (const grupo of grupos) {
      if (!Array.isArray(grupo)) continue
      for (const x of grupo) {
        const j = x as Record<string, unknown>
        const id = entero(j['id'])
        if (id === null) continue
        const brutos = j['events']
        if (!Array.isArray(brutos)) continue
        const eventos: EventoConMinuto[] = []
        for (const e of brutos) {
          if (e === null || typeof e !== 'object') continue
          const ev = e as Record<string, unknown>
          const categoria = texto(ev['category'])
          const minuto = entero(ev['minute'])
          if (categoria === '' || minuto === null) continue
          eventos.push({ categoria, minuto })
        }
        if (eventos.length > 0) salida.set(String(id), eventos.sort((a, b) => a.minuto - b.minuto))
      }
    }
  }
  return salida
}
