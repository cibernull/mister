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

/**
 * Que un histórico sea continuo (`comprobarContinuidad`) no significa que
 * esté completo: garantiza que no hay huecos NI SOLAPES entre lo que se
 * recogió, nunca que se haya recogido todo. Un volcado parcial, o una
 * recolección que se detuvo al alcanzar `maxLotes` sin agotar el feed, son
 * perfectamente continuos y pasarían esa comprobación sin protestar.
 */
export class RecoleccionIncompletaError extends Error {
  readonly recoleccion: string

  constructor(recoleccion: string, motivo: string) {
    super(`la recolección "${recoleccion}" no se da por completa: ${motivo}`)
    this.name = 'RecoleccionIncompletaError'
    this.recoleccion = recoleccion
  }
}

/**
 * Comprueba que la recolección llegó de verdad al final del feed: que la
 * última captura (la de mayor offset) sea el marcador de fin real —
 * `status: "end"` y `nEventos: 0` — y no un lote intermedio cualquiera.
 *
 * Complementa a `comprobarContinuidad`, no la sustituye: la continuidad
 * garantiza que no falta nada ENTRE los lotes recogidos, pero nada dice si
 * el recorrido se detuvo antes de tiempo (límite de lotes alcanzado, o un
 * volcado del navegador que no llega al final). Sin esta comprobación, ese
 * histórico incompleto se guardaría entero y se daría por bueno.
 *
 * Se exigen las dos condiciones (`status` Y `nEventos`) en vez de fiarse de
 * una sola: son la misma garantía vista desde dos ángulos —el cuerpo crudo
 * tal y como llegó, y el recuento que se derivó de él al guardarlo—, y
 * comprobar ambas detecta también una inconsistencia entre ellas, que sería
 * en sí misma una forma inesperada.
 */
export function comprobarCompletitud(capturas: Captura[]): void {
  if (capturas.length === 0) {
    throw new RecoleccionIncompletaError(
      '(desconocida)',
      'no hay ninguna captura guardada; no existe un marcador de fin que comprobar',
    )
  }

  const ultima = capturas[capturas.length - 1]!
  const recoleccion = ultima.recoleccion

  let cuerpo: { status?: unknown }
  try {
    cuerpo = JSON.parse(ultima.cuerpo) as { status?: unknown }
  } catch (e) {
    throw new RecoleccionIncompletaError(
      recoleccion,
      `la última captura (offset ${ultima.offset}) no contiene JSON válido: ${(e as Error).message}`,
    )
  }

  if (cuerpo.status !== 'end' || ultima.nEventos !== 0) {
    throw new RecoleccionIncompletaError(
      recoleccion,
      `la última captura (offset ${ultima.offset}) no es el marcador de fin del feed ` +
        `(se esperaba "status":"end" y nEventos: 0; se halló status=${JSON.stringify(cuerpo.status)}, ` +
        `nEventos=${ultima.nEventos})`,
    )
  }
}
