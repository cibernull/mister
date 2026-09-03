/**
 * La página de un equipo activo no trajo ningún enlace a jugador.
 *
 * Para un equipo activo, una plantilla vacía no es un resultado legítimo:
 * significa que el marcado de la página cambió y la extracción se rompió.
 * Devolver `[]` haría indistinguible "este equipo no tiene jugadores" de "no
 * supe leerlos", y un reparto inicial vacío falsearía el saldo entero de ese
 * equipo.
 */
export class PlantillaVaciaError extends Error {
  constructor() {
    super('la página del equipo no contiene ningún enlace a jugador (players/{id}/{slug})')
    this.name = 'PlantillaVaciaError'
  }
}

/**
 * Un jugador de la plantilla, identificado por su `id` estable y con el
 * `slug` de nombre que trae el propio enlace.
 *
 * El `slug` (p. ej. `jose-gimenez` en `players/34/jose-gimenez`) es la única
 * fuente de nombre de jugador disponible en esta página: la Fase 3 necesita
 * buscar jugadores por nombre, y sin capturarlo aquí no hay ningún otro
 * sitio de donde sacarlo para los jugadores de una plantilla.
 */
export type JugadorPlantilla = {
  idJugador: number
  slug: string
}

/**
 * Identificadores (y slug de nombre) de los jugadores de una plantilla,
 * leídos de los enlaces `players/{id}/{slug}` de la página de un equipo.
 */
export function parsearPlantilla(html: string): JugadorPlantilla[] {
  const vistos = new Map<number, string>()
  const orden: JugadorPlantilla[] = []

  // La ruta va anclada al principio del camino, justo tras el origen
  // opcional (esquema + dominio): `[^"]*` sin anclar dejaba colar cualquier
  // URL que contuviera la subcadena "players/" en cualquier punto —p. ej. un
  // enlace de publicidad o de seguimiento con `?u=/players/99/x`—, como si
  // fuera un jugador real de la plantilla.
  for (const m of html.matchAll(/href="(?:https?:\/\/[^"/]+)?\/?players\/(\d+)\/([^"/]+)/g)) {
    const idJugador = Number(m[1])
    const slug = m[2]!

    const slugVisto = vistos.get(idJugador)
    if (slugVisto === undefined) {
      vistos.set(idJugador, slug)
      orden.push({ idJugador, slug })
    } else if (slugVisto !== slug) {
      // El mismo idJugador con dos slugs distintos en una misma página no es
      // el mismo enlace repetido (eso sería legítimo y se ignora abajo): es
      // una anomalía. Elegir uno de los dos en silencio podría, más
      // adelante, asociar el nombre equivocado a ese id.
      throw new Error(
        `el idJugador ${idJugador} aparece con dos slugs distintos en la misma página: ` +
          `"${slugVisto}" y "${slug}"`,
      )
    }
  }

  if (orden.length === 0) throw new PlantillaVaciaError()

  return orden
}
