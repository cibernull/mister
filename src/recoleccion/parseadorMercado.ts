/**
 * Quién está hoy en el mercado, leído de la propia página `/market`.
 *
 * El feed publica un evento `market_unified` cada vez que el mercado rota,
 * pero solo con los jugadores que ENTRAN en ese ciclo —tres cada vez—, no con
 * el mercado entero. Tomar aquel evento por «el mercado» dejaba la etiqueta
 * «en venta» en tres jugadores cuando había treinta y tres a la venta.
 *
 * La página del mercado sí los trae todos, y además dice el precio de salida y
 * si el que lo vende es un rival o el propio juego.
 */

/** Un jugador puesto a la venta hoy. */
export type EnVenta = {
  id: string
  /** Lo que pide el vendedor. */
  precio: number
  /** `id_uc` del rival que lo vende, o `null` si lo ofrece el mercado. */
  idUcVendedor: number | null
  /**
   * Su dueño lo ofrece en cesión, no en venta.
   *
   * Mister lo marca con `data-loanable` en el puesto del mercado. Hoy no hay
   * ninguno, pero la liga las tiene permitidas (`loans: 1`) y cuando aparezcan
   * hay que poder distinguirlos: una cesión no es un fichaje.
   */
  cedible: boolean
}

/**
 * La página del mercado no trajo ni un jugador.
 *
 * Un mercado vacío es posible de verdad —justo al rotar, o si la liga lo tiene
 * apagado—, pero es indistinguible de que el marcado haya cambiado y la
 * extracción se haya roto. Quien llama decide qué hacer; aquí se avisa.
 */
export class MercadoVacioError extends Error {
  constructor() {
    super('la página del mercado no contiene ningún jugador a la venta')
    this.name = 'MercadoVacioError'
  }
}

/** Los jugadores a la venta, en el orden en que los pinta Mister. */
export function parsearMercado(html: string): EnVenta[] {
  const salida: EnVenta[] = []
  const vistos = new Set<string>()

  // Cada puesto del mercado es un <li> con el precio y el vendedor en sus
  // atributos y un enlace al jugador dentro. Se trocea por <li porque el
  // marcado de dentro cambia según el jugador (cesión, timer, pujas…) y una
  // sola expresión que abarcara todo el bloque sería frágil.
  for (const trozo of html.split(/<li\b/i).slice(1)) {
    const enlace = /href="(?:https?:\/\/[^"/]+)?\/?players\/(\d+)\//.exec(trozo)
    if (enlace === null) continue
    const precio = /\bdata-price="(\d+)"/.exec(trozo)
    if (precio === null) continue

    const id = enlace[1]!
    // El mismo jugador dos veces en el mercado no tiene sentido y apunta a que
    // se está leyendo otra lista de la página, no la del mercado.
    if (vistos.has(id)) continue
    vistos.add(id)

    const duenio = /\bdata-owner="(\d*)"/.exec(trozo)
    const idUc = duenio && duenio[1] !== '' ? Number(duenio[1]) : 0

    const cesion = /\bdata-loanable="([^"]*)"/.exec(trozo)
    salida.push({
      id,
      precio: Number(precio[1]),
      idUcVendedor: idUc === 0 ? null : idUc,
      cedible: cesion !== null && cesion[1] !== '',
    })
  }

  if (salida.length === 0) throw new MercadoVacioError()
  return salida
}
