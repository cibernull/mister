/**
 * Lo que la ficha de un jugador dice de él además de su serie de valores.
 *
 * Hace falta para los jugadores que **no aparecen en el feed**. Mister no
 * publica todas las altas como traspaso —hay jugadores que entran en una
 * plantilla sin dejar rastro— y de esos no hay nombre, ni posición, ni nada
 * en ningún otro sitio. Sin esto salen en la plantilla como «jugador 25579».
 */

export type Ficha = {
  nombre: string
  /** 1 portero, 2 defensa, 3 centrocampista, 4 delantero. 0 si no lo dice. */
  posicion: number
  /** Goles y tarjetas de la temporada. `null` si la ficha no los publica. */
  goles: number | null
  tarjetas: number | null
  /** Su media jugando en casa y fuera. Suelen no parecerse en nada. */
  mediaCasa: number | null
  mediaFuera: number | null
  edad: number | null
  /**
   * Si Mister lo da por titular en el próximo partido.
   *
   * Es la predicción del propio juego, la misma que sale en su ficha. `null`
   * cuando no la publica —lesionados, o partido sin alineación probable aún—,
   * que no es lo mismo que decir que va al banquillo.
   */
  titular: boolean | null
  /** Jornadas jugadas de inicio y saliendo desde el banquillo. */
  titularidades: number
  suplencias: number
}

export class FichaIlegibleError extends Error {
  constructor(motivo: string) {
    super(`no pude leer la ficha del jugador: ${motivo}`)
    this.name = 'FichaIlegibleError'
  }
}

/**
 * El nombre sale del `<title id="page-title">Nombre Apellido | Mister</title>`,
 * y la posición del `data-position` del bloque que además lleva la clase
 * `player-position`.
 *
 * Si el nombre no está, es error: dar uno inventado a partir del slug perdería
 * las tildes y la ñ, y quedaría ahí para siempre sin que nadie lo notara. La
 * posición sí puede faltar —se pinta un dorsal gris— porque no cambia ninguna
 * cuenta.
 */
export function parsearFicha(html: string): Ficha {
  const titulo = /<title[^>]*>([^<]*)<\/title>/i.exec(html)
  if (!titulo) throw new FichaIlegibleError('no tiene <title>')

  // El título es «Nombre Apellido | Mister»; sin la coletilla no es una ficha.
  const nombre = titulo[1]!.split('|')[0]!.trim()
  if (nombre === '' || !titulo[1]!.includes('|')) {
    throw new FichaIlegibleError(`el título no tiene la forma esperada: ${JSON.stringify(titulo[1])}`)
  }

  // Ojo: la ficha lleva en su <style> reglas como
  //   .player-position[data-position="1"]:after { content: "PT" }
  // así que buscar el atributo suelto devolvía siempre 1. Tiene que ser el
  // atributo de un elemento que además tenga la clase.
  const pos = /class=['"][^'"]*player-position[^'"]*['"][^>]*data-position=['"](\d)['"]/.exec(html)

  // El resto son adornos: si alguno falta se va a `null` y la página lo omite.
  // Ninguno entra en una cuenta de dinero, así que no vale la pena romper una
  // pasada de 523 fichas porque a uno le falte la media en casa.
  const plano = html.replace(/\s+/g, ' ')
  const jugadas = plano.match(/class="gw btn btn-player-gw gw-played"[\s\S]*?(?=class="gw btn|$)/g) ?? []

  return {
    nombre,
    posicion: pos ? Number(pos[1]) : 0,
    goles: etiqueta(plano, 'Goles'),
    tarjetas: etiqueta(plano, 'Tarjetas'),
    mediaCasa: etiqueta(plano, 'Media en casa'),
    mediaFuera: etiqueta(plano, 'Media fuera'),
    edad: etiqueta(plano, 'Edad'),
    // `starting` en el botón del próximo partido es el «Posible titular en este
    // partido» que Mister pinta. Que no esté el botón no es un «no»: es que no
    // hay predicción.
    titular: /class="btn btn-sw match ([^"]*)"/.test(plano)
      ? /class="btn btn-sw match [^"]*starting/.test(plano)
      : null,
    // En cada jornada jugada, el icono dice si salió de inicio o del banquillo.
    titularidades: jugadas.filter((g) => g.includes('#jersey')).length,
    suplencias: jugadas.filter((g) => g.includes('#bench')).length,
  }
}

/**
 * Una de las cifras del cuadro de estadísticas: `<div class="label">Goles</div>
 * <div class="value">5</div>`.
 *
 * Se leen con separadores españoles: el punto es de millares y la coma es
 * decimal. Tratarlo como un número inglés convertiría una media de 15,7 en
 * 157, y un valor de 20.146.000 en 20,146.
 */
function etiqueta(plano: string, cual: string): number | null {
  const escapado = cual.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`<div class="label">\\s*${escapado}\\s*</div> <div class="value">([^<]*)</div>`).exec(plano)
  if (!m) return null
  const crudo = m[1]!.trim().replace(/\./g, '').replace(',', '.')
  const n = Number(crudo)
  return crudo !== '' && Number.isFinite(n) ? n : null
}
