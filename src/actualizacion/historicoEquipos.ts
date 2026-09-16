/**
 * El histórico de caja y plantilla de cada equipo, día a día.
 *
 * Mister no dice si un equipo ha ganado o perdido dinero de un día para otro:
 * la clasificación solo enseña la foto de hoy. Guardando esa foto cada día, la
 * página puede decir «ganó/perdió X hoy» con un dato exacto —la resta de dos
 * fotos reales de Mister—, no con una estimación.
 */

/** Lo que hace falta de un equipo para saber si ha ganado o perdido dinero. */
export type FotoEquipo = { saldo: number; pl: number }

/** `{ 'YYYY-MM-DD': { nombreEquipo: FotoEquipo } }`. */
export type HistoricoEquipos = Record<string, Record<string, FotoEquipo>>

/** Días que se guardan. Con 10 sobra de margen para comparar con ayer. */
export const DIAS_DE_HISTORICO_EQUIPOS = 10

/**
 * Añade la foto de hoy de todos los equipos y tira las más viejas.
 *
 * No modifica `historico`: devuelve uno nuevo. Si la función se llama varias
 * veces el mismo día —la actualización corre cada hora—, la última pasada
 * gana: es la foto más reciente de hoy, no un acumulado.
 */
export function actualizarHistoricoEquipos(
  historico: HistoricoEquipos,
  hoy: string,
  equipos: { n: string; saldo: number; pl: number }[],
  dias: number = DIAS_DE_HISTORICO_EQUIPOS,
): HistoricoEquipos {
  const conHoy: HistoricoEquipos = {
    ...historico,
    [hoy]: Object.fromEntries(equipos.map((e) => [e.n, { saldo: e.saldo, pl: e.pl }])),
  }
  const diasAGuardar = Object.keys(conHoy).sort().slice(-dias)
  return Object.fromEntries(diasAGuardar.map((d) => [d, conHoy[d]!]))
}
