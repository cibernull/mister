/**
 * Lectura del volcado del feed: de páginas crudas a los hechos que interesan.
 *
 * El feed es la única fuente de la liga. Trae, en un mismo sitio, los
 * traspasos, las salidas de LaLiga, los cierres de jornada con sus premios y
 * el mercado del día con la cláusula, el dueño y las estadísticas de cada
 * jugador listado.
 *
 * Nada de esto interpreta dinero ni decide nada: solo separa y deduplica.
 */

/** Una página tal cual la devolvió `POST /ajax/feed`. */
export type PaginaCruda = {
  offset: number
  cuerpo: string
  capturadaEn: string
}

export type Volcado = { paginas: PaginaCruda[] }

/** Un movimiento entre dos partes. `idUc` 0 (o ausente) es el mercado. */
export type Traspaso = {
  idTransfer: number
  idJugador: string
  nombre: string
  de: string | null
  a: string | null
  idUcDe: number
  idUcA: number
  importe: number
  tipo: string
  cuando: string
  /** Valor, puntos y media del jugador tal como los traía ese evento. */
  valor: number
  /** 1 portero, 2 defensa, 3 centrocampista, 4 delantero. */
  posicion: number
  puntos: number
  media: number
  racha: string
}

/** Un jugador que se fue de LaLiga: deja de estar en cualquier plantilla. */
export type Salida = { idJugador: string; cuando: string }

export type Jornada = {
  idJornada: number
  jornada: number
  cuando: string
  posiciones: { idUc: number; puntos: number; puesto: number; valorPlantilla: number; premio: number }[]
}

/** Un jugador del mercado del día, con lo que solo el mercado publica. */
export type EnMercado = {
  idJugador: string
  nombre: string
  valor: number
  valorPrevio: number
  media: number
  puntos: number
  partidos: number
  clausula: number | null
  idDuenio: number | null
  posicion: number
}

export type Hechos = {
  traspasos: Traspaso[]
  salidas: Salida[]
  jornadas: Jornada[]
  mercado: EnMercado[]
  /** Momento del evento más reciente visto, para saber hasta dónde llega. */
  hasta: string | null
}

const arr = (x: unknown): unknown[] =>
  Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x as object) : []

const num = (x: unknown, campo: string): number => {
  if (typeof x === 'number' && Number.isFinite(x)) return x
  if (typeof x === 'string' && /^-?\d+$/.test(x)) return Number(x)
  throw new Error(`el campo ${campo} no es un número: ${JSON.stringify(x)}`)
}

const texto = (x: unknown, campo: string): string => {
  if (typeof x === 'string' && x !== '') return x
  throw new Error(`el campo ${campo} no es un texto con contenido: ${JSON.stringify(x)}`)
}

/**
 * Recorre las páginas y devuelve los hechos, deduplicados.
 *
 * El feed crece por arriba mientras se pagina, así que un mismo evento aparece
 * en dos páginas contiguas. Se deduplica por `id_transfer` y por
 * `id_gameweek`, quedándose con la primera aparición.
 */
export function extraerHechos(volcado: Volcado): Hechos {
  const traspasos = new Map<number, Traspaso>()
  const salidas = new Map<string, Salida>()
  const jornadas = new Map<number, Jornada>()
  let mercado: EnMercado[] = []
  let hasta: string | null = null

  // De la captura más antigua a la más nueva, dejando que la nueva pise a la
  // vieja. Los hechos de un traspaso no cambian, pero el valor del jugador que
  // viaja con él sí: el feed lo reescribe con el de hoy cada vez que se pide,
  // y al recolectar en incremental las páginas viejas se quedan con el de
  // entonces. Quedarse con la primera aparición congelaría esos valores.
  const enOrden = [...volcado.paginas].sort((a, b) => a.capturadaEn.localeCompare(b.capturadaEn))
  for (const pagina of enOrden) {
    let cuerpo: { status?: string; data?: unknown }
    try {
      cuerpo = JSON.parse(pagina.cuerpo)
    } catch {
      throw new Error(`la página con offset ${pagina.offset} no es JSON válido`)
    }
    // Sin `data` no hay eventos: es el final del histórico o un rechazo. Quien
    // recolecta ya distingue ambos casos; aquí simplemente no hay nada.
    if (cuerpo.data === undefined) continue

    for (const evento of arr(cuerpo.data) as Record<string, unknown>[]) {
      const cuando = texto(evento['created'], 'created')
      if (hasta === null || cuando > hasta) hasta = cuando

      switch (evento['category']) {
        case 'transfer':
          for (const m of arr(evento['data']) as Record<string, unknown>[]) {
            const idTransfer = num(m['id_transfer'], 'id_transfer')
            traspasos.set(idTransfer, {
              idTransfer,
              idJugador: String(num(m['id'], 'id')),
              nombre: texto(m['name'], 'name'),
              de: typeof m['from'] === 'string' ? m['from'] : null,
              a: typeof m['to'] === 'string' ? m['to'] : null,
              idUcDe: num(m['id_uc_from'] ?? 0, 'id_uc_from'),
              idUcA: num(m['id_uc_to'] ?? 0, 'id_uc_to'),
              importe: num(m['price'], 'price'),
              tipo: texto(m['type'], 'type'),
              cuando,
              valor: num(m['value'], 'value'),
              posicion: num(m['position'] ?? 0, 'position'),
              puntos: num(m['points'] ?? 0, 'points'),
              media: typeof m['avg'] === 'number' ? m['avg'] : 0,
              racha: typeof m['streak'] === 'string' ? m['streak'] : '',
            })
          }
          break

        case 'player_transfer':
          for (const m of arr(evento['data']) as Record<string, unknown>[]) {
            // `id_team` es el club real, no el equipo de la liga. Irse a 0 es
            // salir de LaLiga, y entonces desaparece de todas las plantillas.
            if (num(m['id_team_to'] ?? -1, 'id_team_to') !== 0) continue
            const idJugador = String(num(m['id'], 'id'))
            if (!salidas.has(idJugador)) salidas.set(idJugador, { idJugador, cuando })
          }
          break

        case 'gameweek_end': {
          const d = evento['data'] as Record<string, unknown>
          const idJornada = num(d['id_gameweek'], 'id_gameweek')
          const ranking = (d['ranking'] as Record<string, unknown>)?.['ranking'] as Record<string, unknown>
          const posiciones = arr(ranking?.['positions']) as Record<string, unknown>[]
          if (posiciones.length === 0) throw new Error(`el cierre de jornada ${idJornada} no trae clasificación`)
          jornadas.set(idJornada, {
            idJornada,
            jornada: num(d['gameweek'], 'gameweek'),
            cuando,
            posiciones: posiciones.map((p) => ({
              idUc: num(p['idUc'], 'idUc'),
              puntos: num(p['points'], 'points'),
              puesto: num(p['rank'], 'rank'),
              valorPlantilla: num(p['teamValue'], 'teamValue'),
              premio: num(p['payment'] ?? 0, 'payment'),
            })),
          })
          break
        }

        case 'market_unified': {
          const lista = arr((evento['data'] as Record<string, unknown>)?.['market']) as Record<string, unknown>[]
          // El mercado es una foto del día: manda el evento más reciente, no
          // la acumulación de todos los que haya en el volcado.
          const leido = lista.map((it) => {
            const j = it['player'] as Record<string, unknown>
            const clausula = j['clause'] as Record<string, unknown> | null
            const racha = j['streak']
            return {
              idJugador: String(num(j['id'], 'id')),
              nombre: texto(j['name'], 'name'),
              valor: num(j['value'], 'value'),
              valorPrevio: num(j['prev_value'] ?? j['value'], 'prev_value'),
              media: typeof j['average'] === 'number' ? j['average'] : 0,
              puntos: num(j['points'] ?? 0, 'points'),
              partidos: Array.isArray(racha) ? racha.length : 0,
              clausula: clausula ? num(clausula['value'], 'clause.value') : null,
              idDuenio: j['ownerId'] == null ? null : num(j['ownerId'], 'ownerId'),
              posicion: num(j['position'] ?? 0, 'position'),
            }
          })
          mercado = leido
          break
        }

        default:
          break
      }
    }
  }

  return {
    traspasos: [...traspasos.values()].sort((a, b) => a.cuando.localeCompare(b.cuando) || a.idTransfer - b.idTransfer),
    salidas: [...salidas.values()],
    jornadas: [...jornadas.values()].sort((a, b) => a.cuando.localeCompare(b.cuando)),
    mercado,
    hasta,
  }
}

/**
 * Los `id_transfer` ya conocidos, para saber dónde parar al recolectar.
 */
export function traspasosConocidos(volcado: Volcado): Set<number> {
  return new Set(extraerHechos(volcado).traspasos.map((t) => t.idTransfer))
}
