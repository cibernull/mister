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
  return { nombre, posicion: pos ? Number(pos[1]) : 0 }
}
