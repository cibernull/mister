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

/**
 * Lo que cuesta cada escalón, sobre el valor del jugador.
 *
 * Es simétrico: subirlo cuesta ese 20 % y bajarlo lo devuelve. Comprobado en el
 * libro de caja propio en los dos sentidos — siete penalizaciones al 20,00 %
 * exacto, y sesenta y siete bonificaciones que encajan con el mismo 20 % por
 * escalón sobre el valor del día en que se bajó.
 */
export const COSTE_MODIFICACION = 0.2

export type Subida = {
  idJugador: string
  equipo: string
  dia: string
  /**
   * Lo que le habrá supuesto: **positivo si lo pagó, negativo si se lo
   * devolvieron**. Bajar una cláusula también mueve dinero.
   */
  coste: number
  /** Escalones que se ha movido: positivo hacia arriba, negativo hacia abajo. */
  escalones: number
  /** En qué multiplicador estaba y en cuál está. */
  antes: number
  despues: number
}

export type Jugador = {
  id: string
  duenio: string | null
  valor: number
  clausula: number | null
}

/**
 * Compara el multiplicador de hoy con el de ayer, en los dos sentidos.
 *
 * **El multiplicador, no la cláusula.** La cláusula se recalcula sola cada día
 * sobre el valor, así que a un jugador que se revaloriza le sube sin que nadie
 * pague: Alfonso Herrero pasó de 11.322.000 € a 11.466.000 € de un día para
 * otro y siguió en ×2,00 clavado. Comparar importes daba trece subidas
 * inventadas en una sola noche y le quitaba diez millones a los rivales.
 *
 * Y se mira también hacia abajo, porque **bajar la cláusula devuelve dinero**.
 * El libro de caja propio lo llama `Bonificación` y lo cobra al mismo precio:
 * Lamine Yamal bajó de ×4,0 a ×1,5 —cinco escalones— y devolvió 13.855.490 €,
 * que es exactamente el 20 % de su valor cinco veces. Sesenta y siete apuntes
 * así hay en el libro. Ignorarlo dejaba el dinero de un rival por debajo de lo
 * que tiene, no por encima, que es el error peligroso.
 *
 * Hace falta el valor de ayer además de la cláusula de ayer: sin él no se puede
 * saber en qué multiplicador estaba.
 */
export function detectarSubidas(
  hoy: Jugador[],
  clausulasAyer: Record<string, number>,
  valoresAyer: Record<string, number>,
  dia: string,
): Subida[] {
  const cambios: Subida[] = []

  for (const j of hoy) {
    if (j.duenio === null || j.clausula === null) continue
    const cAyer = clausulasAyer[j.id]
    const vAyer = valoresAyer[j.id]
    if (cAyer === undefined || vAyer === undefined) continue

    // La cláusula tiene que haberse movido de verdad, y en el mismo sentido.
    // Un escalón la cambia un 20 % largo; el vaivén diario de un valor no llega
    // al 5 %. Sin esta guarda, un jugador con la cláusula congelada al
    // comprarlo y el valor moviéndose cruzaba escalones por casualidad: José
    // Giménez pasó de ×2,653 a ×2,549 con la cláusula clavada en 3.051.354 € y
    // salía como una subida de 478.800 € que nunca pagó.
    const proporcion = j.clausula / cAyer
    if (proporcion > 0.91 && proporcion < 1.1) continue

    const antes = subidasVivas(vAyer, cAyer)
    const despues = subidasVivas(j.valor, j.clausula)
    const escalones = despues - antes
    if (escalones === 0) continue
    if (Math.sign(escalones) !== Math.sign(proporcion - 1)) continue

    cambios.push({
      idJugador: j.id,
      equipo: j.duenio,
      dia,
      coste: Math.round(j.valor * COSTE_MODIFICACION) * escalones,
      escalones,
      antes: CLAUSULA_BASE + ESCALON * antes,
      despues: CLAUSULA_BASE + ESCALON * despues,
    })
  }

  return cambios
}

/**
 * Lo que le ha supuesto a cada equipo mover cláusulas, de lo que hemos visto.
 *
 * Positivo es dinero que salió de su caja; negativo, dinero que entró.
 */
export function gastoPorEquipo(subidas: Subida[]): Map<string, number> {
  const por = new Map<string, number>()
  for (const s of subidas) por.set(s.equipo, (por.get(s.equipo) ?? 0) + s.coste)
  return por
}
