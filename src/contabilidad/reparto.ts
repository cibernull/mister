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

  // 3: bajas de jugadores que un equipo tuviera del reparto y nunca movió.
  //    Si nadie lo compró ni lo vendió, no hay forma de saber de quién era:
  //    se deja fuera y el motor lo declarará como incertidumbre.
  for (const [, r] of repartos) {
    r.jugadores = [...new Set([...r.porVenta, ...r.porPlantilla, ...r.porBaja])]
    r.nombre = nombres.get(r.idUc) ?? r.nombre
  }

  return repartos
}
