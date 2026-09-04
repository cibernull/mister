/**
 * Detectar cuándo un rival le sube la cláusula a un jugador, y lo que le cuesta.
 *
 * Mister cobra por subir una cláusula, y lo apunta como `Penalización` en el
 * libro de caja. Pero el libro de caja solo se puede leer el propio: los saldos
 * de los rivales están ocultos. Así que el dinero de un rival se reconstruye
 * sumando el feed, y al feed le falta justamente eso — lo que dejaba su saldo
 * por encima del de verdad y creciendo.
 *
 * Se puede deducir. Dos cosas se comprobaron contra el libro de caja propio:
 *
 *   1. La cláusula base es **1,5 × el valor**, y se recalcula sola cada día:
 *      61 de los jugadores con dueño están clavados en ese ×1,50.
 *   2. Cada modificación cuesta el **20 % del valor** de ese día, dé igual que
 *      se suba al 100 % o al 300 %. Siete de siete penalizaciones propias con
 *      valor conocido dan 20,00 % exacto, y las dos que parecían no cuadrar
 *      —Roger Brugué y Aubameyang— son el 20 % de lo que se pagó por su
 *      cláusula días antes, que es la base que Mister usa entonces.
 *
 * De modo que una cláusula que sube más de lo que le tocaba por su valor es una
 * modificación, y vale el 20 % de ese valor. Esto solo sirve **hacia delante**:
 * hace falta la foto de ayer para comparar, y sin historial no hay nada que
 * deducir. Adivinar cuántas veces se subió una cláusula en el pasado sería
 * inventar, y este módulo no inventa.
 */

/**
 * Margen para no confundir un redondeo con una subida.
 *
 * Mister publica los valores redondeados a millares y la cláusula base sale de
 * multiplicar por 1,5, así que la comparación baila unos cientos de euros. Un
 * 1 % cubre eso de sobra y se queda muy lejos de una subida de verdad, que
 * multiplica la cláusula.
 */
const MARGEN = 0.01

/** Multiplicador de la cláusula que Mister pone por defecto. */
export const CLAUSULA_BASE = 1.5

/**
 * Cláusula mínima. Por debajo de esto Mister no baja, valga lo que valga.
 *
 * Comprobado: 21 jugadores con dueño tienen la cláusula clavada en 1.000.000 €,
 * con valores de 160.000 a 628.000, y ninguno de ellos llegaría a un millón
 * multiplicando por 1,5. Sin esto, un suplente de 160.000 € salía con la
 * cláusula «subida diez veces» porque su ratio es ×6,25.
 */
export const CLAUSULA_MINIMA = 1_000_000

/** El escalón entre un nivel de cláusula y el siguiente. */
export const ESCALON = 0.5

/**
 * A qué le puede llegar la cláusula de un jugador sin que su dueño pague nada.
 */
export const clausulaBase = (valor: number): number => Math.max(valor * CLAUSULA_BASE, CLAUSULA_MINIMA)

/**
 * Cuántas veces le han subido la cláusula, mirando dónde está hoy.
 *
 * Mister ofrece la cláusula al 50 % (que es la base), 100 %, 150 %, 200 % y
 * 250 %, y el multiplicador resultante es `1 + porcentaje/100`: ×1,5, ×2, ×2,5,
 * ×3, ×3,5. Cada salto de medio punto es una modificación pagada, y se comprobó
 * con Juan Foyth, que pagó tres veces —al 100 %, al 150 % y al 200 %— y hoy
 * está exactamente en ×3,000.
 *
 * Devuelve 0 cuando la cláusula está en su base o cuando no cae en un escalón
 * limpio: eso último son las que quedaron congeladas al comprar al jugador
 * pagando su cláusula, y de ahí no se puede deducir nada.
 */
export function subidasVivas(valor: number, clausula: number): number {
  if (valor <= 0) return 0
  if (clausula <= clausulaBase(valor) * (1 + MARGEN)) return 0
  const escalones = Math.round((clausula / valor - CLAUSULA_BASE) / ESCALON)
  if (escalones <= 0) return 0
  const esperado = valor * (CLAUSULA_BASE + ESCALON * escalones)
  return Math.abs(clausula - esperado) <= esperado * 0.02 ? escalones : 0
}

/** Lo que cuesta cada modificación, sobre el valor del jugador. */
export const COSTE_MODIFICACION = 0.2

export type Subida = {
  idJugador: string
  equipo: string
  dia: string
  /** Lo que Mister le habrá cobrado: el 20 % del valor. */
  coste: number
  clausulaAntes: number
  clausulaDespues: number
}

export type Jugador = {
  id: string
  duenio: string | null
  valor: number
  clausula: number | null
}

/**
 * Compara las cláusulas de hoy con las de la foto anterior.
 *
 * Una cláusula sube sola cuando sube el valor, hasta el ×1,5. Solo cuenta como
 * modificación lo que pase de ahí **y** de donde estaba ayer: sin las dos
 * condiciones, un jugador que se revaloriza fuerte parecería blindado.
 */
export function detectarSubidas(
  hoy: Jugador[],
  clausulasAyer: Record<string, number>,
  dia: string,
): Subida[] {
  const subidas: Subida[] = []

  for (const j of hoy) {
    if (j.duenio === null || j.clausula === null) continue
    const antes = clausulasAyer[j.id]
    if (antes === undefined) continue

    // El techo al que la cláusula puede llegar sin que nadie pague nada.
    const solo = Math.max(antes, clausulaBase(j.valor))
    if (j.clausula <= solo * (1 + MARGEN)) continue

    subidas.push({
      idJugador: j.id,
      equipo: j.duenio,
      dia,
      coste: Math.round(j.valor * COSTE_MODIFICACION),
      clausulaAntes: antes,
      clausulaDespues: j.clausula,
    })
  }

  return subidas
}

/** Lo que lleva gastado cada equipo en subir cláusulas, de lo que hemos visto. */
export function gastoPorEquipo(subidas: Subida[]): Map<string, number> {
  const por = new Map<string, number>()
  for (const s of subidas) por.set(s.equipo, (por.get(s.equipo) ?? 0) + s.coste)
  return por
}
