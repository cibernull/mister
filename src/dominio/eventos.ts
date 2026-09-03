/** Una de las dos partes de una transacción: el mercado o un equipo. */
export type Parte = { clase: 'mercado' } | { clase: 'equipo'; nombre: string }

/** Movimiento de un jugador con importe. */
export type Transaccion = {
  tipo: 'transaccion'
  fecha: string
  jugador: string
  origen: Parte
  destino: Parte
  importe: number
  porClausula: boolean
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
