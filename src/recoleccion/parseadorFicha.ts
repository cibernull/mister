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
  /**
   * Lo que hizo en cada jornada, con sus eventos.
   *
   * Mister lo publica en la ficha y no en el censo, y hasta ahora se tiraba:
   * solo se contaban las camisetas para saber las titularidades. Ahí están los
   * goles y las asistencias **de cada jornada**, que es la única forma de saber
   * cuándo marcó y no solo cuántas veces.
   */
  jornadas: JornadaDeFicha[]
  /** Asistencias de la temporada, sumadas de las jornadas. */
  asistencias: number
}

export type JornadaDeFicha = {
  /** El número que pinta Mister: J1, J2… */
  jornada: number
  /** `null` si esa jornada no la ha jugado o aún no se ha disputado. */
  puntos: number | null
  /** Id del club rival, para pintar su escudo. */
  rival: number | null
  /** Salió de inicio, del banquillo, o no jugó. */
  como: 'inicio' | 'banquillo' | 'no jugó' | null
  /** `goal`, `assist`, `yellow`, `penalty`, `saved_penalty`, `sub_in`, `sub_out`. */
  eventos: string[]
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
/**
 * Las jornadas, una por una, con lo que pasó en cada una.
 *
 * Los eventos van dentro del bloque de la jornada como iconos de un sprite:
 * `#events-goal`, `#events-assist`, `#events-yellow`… y aparte `#jersey` o
 * `#bench`, que dicen si salió de inicio. Costó dar con ellos porque en unas
 * jornadas el bloque de eventos va dentro de la barra de puntos y en otras al
 * lado, según si esa jornada puntuó; buscar solo una de las dos formas hacía
 * creer que Mister no publicaba los goles por jornada.
 */
export function parsearJornadasDeFicha(html: string): JornadaDeFicha[] {
  const bloques = [...html.matchAll(/<div class="gw btn btn-player-gw[\s\S]*?<div class="title">J?(\d+)<\/div>/g)]
  return bloques.map((b) => {
    const trozo = b[0]
    const pts = /class="bg--[a-z]+\s*">\s*([\-\d]+)\s*</.exec(trozo)
    const rival = /teams\/(\d+)\.png/.exec(trozo)
    const como = trozo.includes('#not-played')
      ? ('no jugó' as const)
      : trozo.includes('#jersey')
        ? ('inicio' as const)
        : trozo.includes('#bench')
          ? ('banquillo' as const)
          : null
    return {
      jornada: Number(b[1]),
      puntos: pts ? Number(pts[1]) : null,
      rival: rival ? Number(rival[1]) : null,
      como,
      eventos: [...trozo.matchAll(/#events-([a-z_0-9]+)/g)].map((m) => m[1]!),
    }
  })
}

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

  const jornadas = parsearJornadasDeFicha(html)

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
    jornadas,
    // Las asistencias no salen en el cuadro de arriba de la ficha, solo como
    // icono de cada jornada. Es la única forma de tenerlas.
    asistencias: jornadas.reduce((t, j) => t + j.eventos.filter((e) => e === 'assist').length, 0),
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
