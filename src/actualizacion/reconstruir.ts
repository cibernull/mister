/**
 * De los hechos del feed a las cifras de la liga.
 *
 * Todo lo que cambia sale del feed. Lo único que se da por dado son las
 * constantes del reinicio de liga —quién recibió a quién y cuánto valía ese
 * reparto—, que por definición no vuelven a cambiar.
 *
 *     saldo = (50.000.000 − valor del reparto) + premios + ventas − compras
 *
 * Esa ecuación se verificó al euro contra el tope de puja que publica Mister.
 * Aquí solo se aplica; comprobarla otra vez es tarea de `verificar.ts`.
 */
import type { Hechos } from './feed.js'

export type ConstantesEquipo = {
  nombre: string
  idUc: number
  mio?: boolean
  /** Jugadores recibidos en el reparto del reinicio. */
  reparto: string[]
  /** Lo que valía ese reparto el día del reinicio. */
  valorReparto: number
}

export type Constantes = {
  saldoInicialLiga: number
  equipos: ConstantesEquipo[]
}

export type Equipo = {
  n: string
  pos: number
  pts: number
  saldo: number
  pl: number
  rep: number
  ini: number
  com: number
  ven: number
  pre: number
  mio?: 1
  /** Jugadores de la plantilla sin valor conocido: `pl` se queda corto. */
  sinValorar: string[]
}

export type Reconstruccion = {
  equipos: Equipo[]
  plantillas: Record<string, string[]>
  /** Valor de mercado de hoy, por jugador. */
  valores: Map<string, number>
  clausulas: Map<string, number>
  /** Avisos que no impiden seguir pero que hay que enseñar. */
  avisos: string[]
}

/**
 * Reconstruye plantillas, saldos y puntos a día de hoy.
 *
 * `valoresExtra` cubre a los jugadores que nunca han pasado por el feed —los
 * que siguen en la plantilla del reparto y nadie ha movido—, cuyo valor solo
 * está en su ficha.
 */
export function reconstruir(
  hechos: Hechos,
  constantes: Constantes,
  valoresExtra: Map<string, number> = new Map(),
): Reconstruccion {
  const avisos: string[] = []
  const porUc = new Map<number, ConstantesEquipo>()
  const porNombre = new Map<string, ConstantesEquipo>()
  for (const e of constantes.equipos) {
    porUc.set(e.idUc, e)
    porNombre.set(e.nombre, e)
  }

  // ── Valor de hoy de cada jugador ───────────────────────────────────────────
  // El feed reescribe el objeto del jugador con su valor actual cada vez que
  // se pide, así que la aparición más reciente manda. El mercado del día es la
  // fuente más fresca de todas.
  const valores = new Map<string, number>(valoresExtra)
  for (const t of hechos.traspasos) valores.set(t.idJugador, t.valor)
  for (const m of hechos.mercado) valores.set(m.idJugador, m.valor)

  const clausulas = new Map<string, number>()
  for (const m of hechos.mercado) if (m.clausula !== null) clausulas.set(m.idJugador, m.clausula)

  // ── Plantillas: el reparto, más lo que entró, menos lo que salió ───────────
  const plantillas = new Map<string, Set<string>>()
  for (const e of constantes.equipos) plantillas.set(e.nombre, new Set(e.reparto))

  // Un equipo puede haberse cambiado el nombre a mitad de temporada, y los
  // traspasos antiguos llevan el nombre viejo. El idUc no cambia nunca, así
  // que es él quien manda; el nombre solo se usa para presentar.
  const equipoDe = (idUc: number, nombre: string | null): ConstantesEquipo | undefined => {
    if (idUc !== 0) return porUc.get(idUc)
    return nombre === null ? undefined : porNombre.get(nombre)
  }

  for (const t of hechos.traspasos) {
    if (t.idUcDe !== 0) {
      const e = equipoDe(t.idUcDe, t.de)
      if (!e) throw new Error(`traspaso ${t.idTransfer}: no conozco al equipo que vende (idUc ${t.idUcDe})`)
      if (!plantillas.get(e.nombre)!.delete(t.idJugador)) {
        avisos.push(`${e.nombre} vendió a ${t.nombre} el ${t.cuando.slice(0, 10)} sin que constara en su plantilla`)
      }
    }
    if (t.idUcA !== 0) {
      const e = equipoDe(t.idUcA, t.a)
      if (!e) throw new Error(`traspaso ${t.idTransfer}: no conozco al equipo que compra (idUc ${t.idUcA})`)
      plantillas.get(e.nombre)!.add(t.idJugador)
    }
  }
  // Salir de LaLiga vacía la ficha: el jugador desaparece de toda plantilla.
  for (const s of hechos.salidas) for (const set of plantillas.values()) set.delete(s.idJugador)

  // ── Dinero y puntos ────────────────────────────────────────────────────────
  const acumulado = new Map<number, { pts: number; pre: number }>()
  for (const j of hechos.jornadas) {
    for (const p of j.posiciones) {
      const a = acumulado.get(p.idUc) ?? { pts: 0, pre: 0 }
      a.pts += p.puntos
      a.pre += p.premio
      acumulado.set(p.idUc, a)
    }
  }

  const equipos: Equipo[] = constantes.equipos.map((e) => {
    let com = 0
    let ven = 0
    for (const t of hechos.traspasos) {
      if (t.idUcA === e.idUc) com += t.importe
      if (t.idUcDe === e.idUc) ven += t.importe
    }
    const a = acumulado.get(e.idUc) ?? { pts: 0, pre: 0 }
    const ini = constantes.saldoInicialLiga - e.valorReparto
    const plantilla = [...plantillas.get(e.nombre)!]
    const sinValorar = plantilla.filter((id) => !valores.has(id))
    const pl = plantilla.reduce((s, id) => s + (valores.get(id) ?? 0), 0)
    return {
      n: e.nombre,
      pos: 0,
      pts: a.pts,
      saldo: ini + a.pre + ven - com,
      pl,
      rep: e.valorReparto,
      ini,
      com,
      ven,
      pre: a.pre,
      ...(e.mio ? { mio: 1 as const } : {}),
      sinValorar,
    }
  })

  // El puesto sale de los puntos, que es como lo ordena Mister.
  ;[...equipos].sort((x, y) => y.pts - x.pts).forEach((e, i) => (e.pos = i + 1))

  for (const e of equipos) {
    if (e.sinValorar.length > 0) {
      avisos.push(
        `${e.n}: ${e.sinValorar.length} jugador${e.sinValorar.length === 1 ? '' : 'es'} sin valor conocido, ` +
          `así que su plantilla y su tope de puja se quedan cortos`,
      )
    }
  }

  return {
    equipos,
    plantillas: Object.fromEntries([...plantillas].map(([k, v]) => [k, [...v]])),
    valores,
    clausulas,
    avisos,
  }
}
