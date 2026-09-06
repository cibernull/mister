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
  /** Ruta de su página, de donde salen los slugs de sus jugadores. */
  url: string
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
  /** Cuántos jugadores tiene. Se contrasta con la clasificación de Mister. */
  plantilla: number
  /** Subidas de cláusula que siguen vivas en su plantilla. */
  subidas?: number
  /** Cuántos jugadores suyos las tienen. */
  blindados?: number
  /** Lo que costarían esas subidas al valor de hoy. Aproximado. */
  costeSubidas?: number
  /** Lo que se le ha visto pagar desde que llevamos la cuenta. Exacto. */
  gastoVisto?: number
  /** Solo el equipo propio: lo que dice su libro de caja. Exacto. */
  costeReal?: number
  /**
   * Dinero retenido por pujas vivas. Está en el saldo pero ya no se puede
   * gastar, y Mister lo descuenta del tope de puja. Solo se conoce el propio:
   * de los rivales no publica nada, así que en los suyos es siempre `undefined`.
   */
  comprometido?: number
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
  plantillasReales?: Map<string, string[]>,
): Reconstruccion {
  const avisos: string[] = []
  const porUc = new Map<number, ConstantesEquipo>()
  const porNombre = new Map<string, ConstantesEquipo>()
  for (const e of constantes.equipos) {
    porUc.set(e.idUc, e)
    porNombre.set(e.nombre, e)
  }

  // ── Valor de hoy de cada jugador, de la fuente más fresca a la más vieja ───
  // De menos a más fiable, pisando lo anterior:
  //   1. el feed, que guarda el valor que tenía el jugador el DÍA DE SU
  //      TRASPASO, no el de hoy;
  //   2. el mercado del día, que sí es de hoy pero solo cubre a los listados;
  //   3. su ficha, pedida hoy, que es la única fuente al día de todos.
  // Tenerlo al revés dejaba el valor de plantilla corto y el tope de puja no
  // cuadraba con el de Mister.
  const valores = new Map<string, number>()
  for (const t of hechos.traspasos) valores.set(t.idJugador, t.valor)
  for (const m of hechos.mercado) valores.set(m.idJugador, m.valor)
  for (const [id, v] of valoresExtra) valores.set(id, v)

  const clausulas = new Map<string, number>()
  for (const m of hechos.mercado) if (m.clausula !== null) clausulas.set(m.idJugador, m.clausula)

  // ── Plantillas ─────────────────────────────────────────────────────────────
  // Manda la página de cada equipo cuando se ha podido leer. El feed NO vale
  // para esto: hay incorporaciones que no publica como traspaso —Beñat
  // Gerenabarrena y Oriol Rey entraron en Niutin FC sin dejar rastro—, así que
  // reconstruir la plantilla sumando traspasos deja jugadores fuera y el valor
  // de plantilla corto. Para el dinero el feed sí basta: esas altas no costaron
  // nada y el saldo calculado sigue cuadrando con el de Mister.
  const plantillas = new Map<string, Set<string>>()
  const derivadas = plantillasReales === undefined
  for (const e of constantes.equipos) {
    plantillas.set(e.nombre, new Set(plantillasReales?.get(e.nombre) ?? e.reparto))
  }

  // Un equipo puede haberse cambiado el nombre a mitad de temporada, y los
  // traspasos antiguos llevan el nombre viejo. El idUc no cambia nunca, así
  // que es él quien manda; el nombre solo se usa para presentar.
  const equipoDe = (idUc: number, nombre: string | null): ConstantesEquipo | undefined => {
    if (idUc !== 0) return porUc.get(idUc)
    return nombre === null ? undefined : porNombre.get(nombre)
  }

  for (const t of derivadas ? hechos.traspasos : []) {
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
  // Salir de LaLiga NO vacía la plantilla: Mister sigue contando al jugador,
  // con su valor residual. Se comprobó contra la clasificación, que publica
  // cuántos jugadores tiene cada equipo y cuánto vale su plantilla: Los
  // tocahuevos salían con 13 jugadores y 32.359.000 € cuando Mister decía 14 y
  // 33.658.000 €, y el que faltaba era Matteo Ruggeri, borrado justamente por
  // esto. Solo se aplica al camino derivado, donde no hay página que mande.
  if (derivadas) {
    for (const s of hechos.salidas) for (const set of plantillas.values()) set.delete(s.idJugador)
  }

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
      plantilla: plantilla.length,
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
