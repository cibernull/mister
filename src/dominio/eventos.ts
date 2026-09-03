/**
 * Una de las dos partes de una transacción: el mercado o un equipo.
 *
 * La identidad estable de un equipo es su `idUc`, no su nombre: el histórico
 * contiene cambios de nombre reales, y apoyar la contabilidad en una cadena
 * mutable es frágil. El mercado no tiene `idUc` en el crudo (su `id_uc` es
 * siempre 0), así que el tipo no le da uno.
 */
export type Parte = { clase: 'mercado' } | { clase: 'equipo'; nombre: string; idUc: number }

/** Los tres tipos de movimiento observados en el histórico. */
export type TipoOperacion = 'normal' | 'clause' | 'rescind'

/** Movimiento de un jugador con importe. */
export type Transaccion = {
  tipo: 'transaccion'
  /**
   * `id` del evento bruto del que procede este movimiento. Sirve de
   * desempate temporal: `fecha` tiene resolución de segundo y dos eventos
   * pueden compartirla. Varias transacciones (los movimientos de un mismo
   * `transfer`) comparten el mismo `idEvento`.
   */
  idEvento: number
  fecha: string
  jugador: string
  origen: Parte
  destino: Parte
  importe: number
  /** Tipo de operación tal y como lo publica Mister. */
  operacion: TipoOperacion
  /** Identificador de la operación en el crudo de Mister; sirve para conciliar y depurar. */
  idTransfer: number
}

/** Resultado de un equipo en el cierre de una jornada. */
export type ResultadoEquipo = {
  equipo: string
  /** Identidad estable del equipo (ver `Parte`); no cambia si se renombra. */
  idUc: number
  premio: number
  puntos: number
  /** Mister no reparte premio a quien tiene saldo negativo. */
  sinPuntuar: boolean
  /** Valor de la plantilla en esa jornada. Entra en la fórmula del tope de puja. */
  valorPlantilla: number
}

export type CierreJornada = {
  tipo: 'cierreJornada'
  /** `id` del evento bruto `gameweek_end`. Ver `Transaccion.idEvento`. */
  idEvento: number
  fecha: string
  jornada: number
  resultados: ResultadoEquipo[]
}

/** Evento reconocido pero sin efecto contable, p. ej. fichajes de LaLiga. */
export type Ruido = {
  tipo: 'ruido'
  /** `id` del evento bruto. Ver `Transaccion.idEvento`. */
  idEvento: number
  fecha: string
  motivo: string
}

export type Evento = Transaccion | CierreJornada | Ruido

/** Un evento es contable si mueve dinero de algún equipo. */
export function esContable(e: Evento): e is Transaccion | CierreJornada {
  return e.tipo === 'transaccion' || e.tipo === 'cierreJornada'
}
