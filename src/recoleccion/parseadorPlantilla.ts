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
 * Identificadores de los jugadores de una plantilla, leídos de los enlaces
 * `players/{id}/{slug}` de la página de un equipo.
 */
export function parsearPlantilla(html: string): number[] {
  const vistos = new Set<number>()
  const orden: number[] = []

  // La ruta va anclada al principio del camino, justo tras el origen
  // opcional (esquema + dominio): `[^"]*` sin anclar dejaba colar cualquier
  // URL que contuviera la subcadena "players/" en cualquier punto —p. ej. un
  // enlace de publicidad o de seguimiento con `?u=/players/99/x`—, como si
  // fuera un jugador real de la plantilla.
  for (const m of html.matchAll(/href="(?:https?:\/\/[^"/]+)?\/?players\/(\d+)\//g)) {
    const id = Number(m[1])
    if (!vistos.has(id)) { vistos.add(id); orden.push(id) }
  }

  if (orden.length === 0) throw new PlantillaVaciaError()

  return orden
}
