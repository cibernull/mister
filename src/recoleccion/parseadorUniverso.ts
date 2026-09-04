/**
 * El censo completo de jugadores, tal como lo da el buscador de Mister.
 *
 * `POST /ajax/sw/players` es la lista que alimenta la pestaña Buscar: todos
 * los jugadores de la competición, de cincuenta en cincuenta, con sus puntos,
 * su media, su racha, su valor de hoy, su cláusula y quién los tiene.
 *
 * Antes todo esto salía del feed de actividad, y el feed solo publica una foto
 * del jugador en el instante de un evento —un traspaso, o los tres que entran
 * al mercado en cada ciclo— y no la refresca nunca. De ahí venían las cifras
 * viejas: un jugador fichado hace una semana seguía enseñando los puntos de
 * aquel día, y quien no había pasado por ninguno de esos dos sitios ni
 * siquiera existía. Con 523 jugadores en LaLiga, el feed conocía 238.
 *
 * Aquí solo se traduce y se comprueba. Nada de esto decide nada.
 */

/** Un jugador de la competición, con lo que Mister sabe de él hoy. */
export type JugadorMister = {
  id: string
  nombre: string
  /** 1 portero, 2 defensa, 3 centrocampista, 4 delantero. */
  posicion: number
  /** Su club real, no el equipo de la liga. */
  idClub: number
  puntos: number
  media: number
  /** Los partidos que ha jugado. Las jornadas en blanco no cuentan. */
  partidos: number
  /** Puntuación jornada a jornada; `null` donde no jugó. */
  racha: (number | null)[]
  valor: number
  /** Lo que ha cambiado su valor desde ayer. */
  sube: number
  /** El equipo de la liga que lo tiene, o `null` si está libre. */
  duenio: string | null
  /** Lo que cuesta arrebatárselo. `null` si está libre: entonces no hay a quién. */
  clausula: number | null
  /** Su cláusula está blindada y no se le puede pagar. */
  blindado: boolean
  /** `null` si está sano; si no, lo que dice Mister: `injury`, `doubt`… */
  estado: string | null
}

const num = (x: unknown, campo: string, de: string): number => {
  if (typeof x === 'number' && Number.isFinite(x)) return x
  if (typeof x === 'string' && /^-?\d+(\.\d+)?$/.test(x)) return Number(x)
  throw new Error(`${de}: el campo ${campo} no es un número: ${JSON.stringify(x)}`)
}

const texto = (x: unknown, campo: string, de: string): string => {
  if (typeof x === 'string' && x !== '') return x
  throw new Error(`${de}: el campo ${campo} no es un texto con contenido: ${JSON.stringify(x)}`)
}

/**
 * Traduce una página del buscador.
 *
 * Se es estricto con los campos que sostienen una cuenta —id, nombre, valor,
 * posición— y flexible con los adornos. Un jugador al que no se le entiende el
 * valor no se ignora en silencio: se rompe la pasada entera, porque una
 * plantilla a la que le falta un valor sale barata sin avisar, y eso es
 * exactamente lo que este módulo no puede permitirse.
 */
export function parsearJugadores(cuerpo: string): JugadorMister[] {
  let json: { status?: unknown; data?: { players?: unknown } }
  try {
    json = JSON.parse(cuerpo) as typeof json
  } catch {
    throw new Error('la respuesta del buscador de jugadores no es JSON válido')
  }
  if (json.status !== 'ok') throw new Error(`el buscador de jugadores respondió status ${JSON.stringify(json.status)}`)

  const lista = json.data?.players
  if (!Array.isArray(lista)) throw new Error('la respuesta del buscador no trae la lista `data.players`')

  return lista.map((x) => {
    const j = x as Record<string, unknown>
    const id = String(num(j['id'], 'id', 'jugador'))
    const de = `jugador ${id}`

    // La racha llega como una casilla por jornada: un número si jugó y el
    // guion si no. Contar las casillas —que es lo que se hacía— daba por
    // jugados los partidos que se pasó en el banquillo.
    const racha = (Array.isArray(j['streak']) ? j['streak'] : []).map((p) =>
      typeof p === 'number' ? p : typeof p === 'string' && /^-?\d+$/.test(p) ? Number(p) : null,
    )

    const idUc = j['id_uc']
    const duenio = idUc == null ? null : texto(j['uc_name'], 'uc_name', de)
    const valor = num(j['value'], 'value', de)

    return {
      id,
      nombre: texto(j['name'], 'name', de),
      posicion: num(j['position'], 'position', de),
      idClub: num(j['id_team'], 'id_team', de),
      puntos: num(j['points'] ?? 0, 'points', de),
      media: typeof j['avg'] === 'number' ? j['avg'] : 0,
      partidos: racha.filter((p) => p !== null).length,
      racha,
      valor,
      // `prev_value` es el valor de ayer. Mister no publica la diferencia, pero
      // restarla da exactamente la misma cifra que la serie diaria de la ficha:
      // comprobado contra los 117 jugadores de los que se tenían ambas.
      sube: valor - num(j['prev_value'] ?? valor, 'prev_value', de),
      duenio,
      // Sin dueño, Mister rellena `clause` con el propio valor. Guardar eso
      // como cláusula haría creer que a un jugador libre se le puede pagar una.
      clausula: duenio === null ? null : num(j['clause'], 'clause', de),
      blindado: num(j['shield'] ?? 0, 'shield', de) > 0,
      estado: typeof j['status'] === 'string' && j['status'] !== '' ? j['status'] : null,
    }
  })
}
