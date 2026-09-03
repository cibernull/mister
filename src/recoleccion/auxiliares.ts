import type { Almacen } from '../almacen/crudo.js'
import type { Cliente } from './cliente.js'

const DOCE_HORAS_MS = 12 * 60 * 60 * 1000

export type DependenciasAux = {
  cliente: Cliente
  almacen: Almacen
  idsUc: number[]
  idsJugador: number[]
  /** Edad a partir de la cual una captura se considera caducada. 12 h por defecto. */
  maxEdadMs?: number
  ahora?: () => number
}

export type ResumenAux = {
  plantillas: number
  jugadores: number
  yaEnCache: number
}

export const rutaEquipo = (idUc: number) => `/users/${idUc}/x`
export const rutaJugador = (idJugador: number) => `/players/${idJugador}/x`

/**
 * Descarga las plantillas actuales y las fichas de jugador que hacen falta.
 *
 * Reutiliza lo guardado mientras siga fresco: son más de cien fichas y volver a
 * pedirlas en cada análisis castigaría el servidor. Pero la plantilla de un
 * equipo y el valor de hoy cambian con cada fichaje, así que la caché caduca:
 * pasada `maxEdadMs`, se vuelve a pedir y se guarda una captura nueva junto a
 * la vieja, sin destruirla.
 */
export async function recolectarAuxiliares(dep: DependenciasAux): Promise<ResumenAux> {
  const resumen: ResumenAux = { plantillas: 0, jugadores: 0, yaEnCache: 0 }
  const maxEdadMs = dep.maxEdadMs ?? DOCE_HORAS_MS
  const ahora = dep.ahora ?? (() => Date.now())

  const fresca = (capturadaEn: string): boolean => {
    const t = Date.parse(capturadaEn)
    if (Number.isNaN(t)) {
      throw new Error(`la captura guardada tiene una fecha ilegible: ${JSON.stringify(capturadaEn)}`)
    }
    return ahora() - t < maxEdadMs
  }

  const pedir = async (ruta: string, contador: 'plantillas' | 'jugadores') => {
    const guardada = dep.almacen.leerPagina(ruta)
    if (guardada && fresca(guardada.capturadaEn)) { resumen.yaEnCache++; return }
    const cuerpo = await dep.cliente.pedirPagina(ruta)
    dep.almacen.guardarPagina({ ruta, cuerpo, capturadaEn: new Date(ahora()).toISOString() })
    resumen[contador]++
  }

  for (const idUc of dep.idsUc) await pedir(rutaEquipo(idUc), 'plantillas')
  for (const id of dep.idsJugador) await pedir(rutaJugador(id), 'jugadores')

  return resumen
}
