/**
 * Identificadores de los jugadores de una plantilla, leídos de los enlaces
 * `players/{id}/{slug}` de la página de un equipo.
 */
export function parsearPlantilla(html: string): number[] {
  const vistos = new Set<number>()
  const orden: number[] = []

  for (const m of html.matchAll(/href="[^"]*players\/(\d+)\//g)) {
    const id = Number(m[1])
    if (!vistos.has(id)) { vistos.add(id); orden.push(id) }
  }

  return orden
}
