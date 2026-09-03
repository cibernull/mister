/** Una de las dos partes de una transacción: el mercado o un equipo. */
export type Parte = { clase: 'mercado' } | { clase: 'equipo'; nombre: string }

/** Los tres tipos de movimiento observados en el histórico. */
export type TipoOperacion = 'normal' | 'clause' | 'rescind'

/** Movimiento de un jugador con importe. */
export type Transaccion = {
  tipo: 'transaccion'
  fecha: string
  jugador: string
  origen: Parte
  destino: Parte
  importe: number
  /** Tipo de operación tal y como lo publica Mister. */
  operacion: TipoOperacion
}

/** Resultado de un equipo en el cierre de una jornada. */
export type ResultadoEquipo = {
  equipo: string
  premio: number
  puntos: number
  /** Mister no reparte premio a quien tiene saldo negativo. */
  sinPuntuar: boolean
}

export type CierreJornada = {
  tipo: 'cierreJornada'
  fecha: string
  jornada: number
  resultados: ResultadoEquipo[]
}

/** Evento reconocido pero sin efecto contable, p. ej. fichajes de LaLiga. */
export type Ruido = { tipo: 'ruido'; fecha: string; motivo: string }

export type Evento = Transaccion | CierreJornada | Ruido

/** Un evento es contable si mueve dinero de algún equipo. */
export function esContable(e: Evento): e is Transaccion | CierreJornada {
  return e.tipo === 'transaccion' || e.tipo === 'cierreJornada'
}
