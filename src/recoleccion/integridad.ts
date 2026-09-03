import type { Captura } from '../almacen/crudo.js'

/** Los lotes recolectados no encajan: faltan eventos o se cuentan dos veces. */
export class DiscontinuidadError extends Error {
  readonly offsetEsperado: number
  readonly offsetHallado: number

  constructor(offsetEsperado: number, offsetHallado: number) {
    super(
      `el histórico no es continuo: se esperaba el offset ${offsetEsperado} ` +
        `y se halló ${offsetHallado}. La recolección no se da por buena.`,
    )
    this.name = 'DiscontinuidadError'
    this.offsetEsperado = offsetEsperado
    this.offsetHallado = offsetHallado
  }
}

/**
 * Comprueba que los lotes recolectados encajan sin hueco ni solape.
 *
 * El feed pagina por offset acumulado: cada página empieza donde acabó la
 * anterior. Un salto significa eventos perdidos —y un saldo plausible pero
 * equivocado—, así que es un error, no un aviso.
 */
export function comprobarContinuidad(capturas: Captura[]): void {
  let esperado = 0

  for (const captura of capturas) {
    if (captura.offset !== esperado) {
      throw new DiscontinuidadError(esperado, captura.offset)
    }
    esperado += captura.nEventos
  }
}
