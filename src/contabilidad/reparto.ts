import type { Evento, Transaccion } from '../dominio/eventos.js'

export type RepartoEquipo = {
  idUc: number
  nombre: string
  /** Unión sin repetidos de las tres vías. */
  jugadores: number[]
  porVenta: number[]
  porPlantilla: number[]
  porBaja: number[]
}

/**
 * Reconstruye qué jugadores recibió cada equipo en el reinicio de la liga.
 *
 * Tres vías, y las tres hacen falta:
 *  - vendió al jugador sin haberlo comprado antes,
 *  - lo conserva hoy sin haberlo comprado,
 *  - desapareció por una baja de plantilla estando en su poder.
 *
 * La tercera es la que se descubrió tarde: un jugador del reparto puede
 * esfumarse al abandonar LaLiga sin dejar ningún movimiento en el feed.
 */
export function reconstruirRepartos(
  eventos: Evento[],
  plantillas: Map<number, number[]>,
  asignaciones: Map<number, number>,
): Map<number, RepartoEquipo> {
  const cronologico = [...eventos].sort((a, b) => a.fecha.localeCompare(b.fecha))

  const repartos = new Map<number, RepartoEquipo>()
  const comprados = new Map<number, Set<number>>()   // idUc -> jugadores comprados
  const nombres = new Map<number, string>()

  const equipo = (idUc: number): RepartoEquipo => {
    let r = repartos.get(idUc)
    if (!r) {
      r = { idUc, nombre: nombres.get(idUc) ?? '', jugadores: [], porVenta: [], porPlantilla: [], porBaja: [] }
      repartos.set(idUc, r)
    }
    return r
  }
  const compradosDe = (idUc: number): Set<number> => {
    let s = comprados.get(idUc)
    if (!s) { s = new Set(); comprados.set(idUc, s) }
    return s
  }

  for (const idUc of plantillas.keys()) equipo(idUc)

  // 1 y preparación: recorrer los movimientos en orden cronológico.
  for (const e of cronologico) {
    if (e.tipo !== 'transaccion') continue
    const t = e as Transaccion

    if (t.origen.clase === 'equipo') {
      const idUc = t.origen.idUc
      nombres.set(idUc, t.origen.nombre)
      const r = equipo(idUc)
      r.nombre = t.origen.nombre
      if (!compradosDe(idUc).has(t.idJugador) && !r.porVenta.includes(t.idJugador)) {
        r.porVenta.push(t.idJugador)
      }
    }

    if (t.destino.clase === 'equipo') {
      const idUc = t.destino.idUc
      nombres.set(idUc, t.destino.nombre)
      equipo(idUc).nombre = t.destino.nombre
      compradosDe(idUc).add(t.idJugador)
    }
  }

  // 2: los que conserva sin haberlos comprado.
  for (const [idUc, jugadores] of plantillas) {
    const r = equipo(idUc)
    for (const id of jugadores) {
      if (!compradosDe(idUc).has(id) && !r.porVenta.includes(id)) r.porPlantilla.push(id)
    }
  }

  // 3: bajas asignadas a mano. Un jugador que desapareció al abandonar LaLiga
  //    y que el equipo NO había comprado formaba parte de su reparto inicial.
  //    Sin asignación no se le atribuye a nadie: adivinarlo produciría una
  //    cifra plausible y equivocada.
  for (const e of cronologico) {
    if (e.tipo !== 'bajaPlantilla') continue
    const idUc = asignaciones.get(e.idJugador)
    if (idUc === undefined) continue

    const r = repartos.get(idUc)
    if (!r) {
      throw new Error(`la baja del jugador ${e.idJugador} está asignada al equipo ${idUc}, que no existe en la liga`)
    }
    if (compradosDe(idUc).has(e.idJugador)) continue
    if (!r.porVenta.includes(e.idJugador) && !r.porBaja.includes(e.idJugador)) {
      r.porBaja.push(e.idJugador)
    }
  }

  // recalcular la unión de las tres vías, sin repetidos.
  for (const [, r] of repartos) {
    r.jugadores = [...new Set([...r.porVenta, ...r.porPlantilla, ...r.porBaja])]
    r.nombre = nombres.get(r.idUc) ?? r.nombre
  }

  return repartos
}

/**
 * Bajas de plantilla que ningún reparto reclama.
 *
 * Cada una es un jugador cuyo dueño no consta en ninguna fuente. Quien llame
 * debe declararlas, no repartirlas: son incertidumbre, no ruido.
 */
export function bajasSinDuenio(
  eventos: Evento[],
  repartos: Map<number, RepartoEquipo>,
): number[] {
  const reclamados = new Set<number>()
  for (const r of repartos.values()) for (const id of r.jugadores) reclamados.add(id)

  // Un jugador que aparece en algún movimiento tiene dueño conocido por el
  // feed, aunque no esté en ningún reparto inicial: no hay incertidumbre.
  const movidos = new Set<number>()
  for (const e of eventos) if (e.tipo === 'transaccion') movidos.add(e.idJugador)

  const sinDuenio: number[] = []
  for (const e of eventos) {
    if (e.tipo !== 'bajaPlantilla') continue
    if (reclamados.has(e.idJugador) || movidos.has(e.idJugador)) continue
    if (!sinDuenio.includes(e.idJugador)) sinDuenio.push(e.idJugador)
  }

  return sinDuenio
}
