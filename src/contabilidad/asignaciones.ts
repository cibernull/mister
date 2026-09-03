import { readFileSync } from 'node:fs'

export class AsignacionesIlegiblesError extends Error {
  constructor(ruta: string, causa: string) {
    super(`el fichero de asignaciones ${ruta} no se pudo leer: ${causa}`)
    this.name = 'AsignacionesIlegiblesError'
  }
}

type AsignacionBruta = { idJugador?: unknown; idUc?: unknown }

/**
 * Lee a qué equipo pertenecía cada baja sin dueño.
 *
 * Un jugador puede desaparecer de un reparto inicial al abandonar LaLiga sin
 * dejar rastro en el feed, y ninguna fuente accesible dice de quién era. Por eso
 * esto es un dato de entrada que aporta la persona: deducirlo por ajuste
 * produciría una cifra plausible y equivocada.
 *
 * Un fichero ausente significa "ninguna asignación", que es un estado legítimo.
 * Un fichero presente pero malformado, en cambio, lanza.
 */
export function leerAsignaciones(ruta: string): Map<number, number> {
  let contenido: string
  try {
    contenido = readFileSync(ruta, 'utf8')
  } catch {
    return new Map()
  }

  let datos: { asignaciones?: unknown }
  try {
    datos = JSON.parse(contenido) as { asignaciones?: unknown }
  } catch (e) {
    throw new AsignacionesIlegiblesError(ruta, (e as Error).message)
  }

  const lista = datos.asignaciones
  if (!Array.isArray(lista)) {
    throw new AsignacionesIlegiblesError(ruta, 'falta la lista `asignaciones`')
  }

  const mapa = new Map<number, number>()
  for (const bruta of lista as AsignacionBruta[]) {
    const idJugador = bruta.idJugador
    const idUc = bruta.idUc
    if (!Number.isInteger(idJugador)) {
      throw new Error(`una asignación de ${ruta} no trae un idJugador entero`)
    }
    if (!Number.isInteger(idUc)) {
      throw new Error(`la asignación del jugador ${idJugador} en ${ruta} no trae un idUc entero`)
    }
    if (mapa.has(idJugador as number)) {
      throw new Error(`el jugador ${idJugador} está asignado dos veces en ${ruta}`)
    }
    mapa.set(idJugador as number, idUc as number)
  }

  return mapa
}
