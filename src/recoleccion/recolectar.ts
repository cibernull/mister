import type { Almacen } from '../almacen/crudo.js'
import type { Cliente } from './cliente.js'
import { comprobarCompletitud, comprobarContinuidad } from './integridad.js'
import { procesarPagina } from './pagina.js'
import type { Resumen } from './pagina.js'

const MAX_LOTES_POR_DEFECTO = 500

export type Dependencias = {
  cliente: Cliente
  almacen: Almacen
  maxLotes?: number
  /** Etiqueta del recorrido. Por defecto, la marca de tiempo del arranque. */
  recoleccion?: string
}

/**
 * Recorre el feed desde el offset 0 hacia atrás hasta agotar el histórico.
 *
 * Guarda el crudo ANTES de interpretarlo: si una categoría no está catalogada,
 * el proceso se detiene pero el lote queda en disco para poder diagnosticarlo.
 *
 * Al terminar el recorrido —agote el feed o alcance `maxLotes`— comprueba que
 * lo guardado es continuo (`comprobarContinuidad`) Y que llegó de verdad al
 * final (`comprobarCompletitud`): la continuidad por sí sola no basta, un
 * recorrido cortado por `maxLotes` es perfectamente continuo y aun así
 * incompleto. El veredicto queda persistido en el almacén
 * (`marcarCompletitud`) para que la Fase 2 no tenga que releer y reinterpretar
 * las capturas para adivinarlo; si la recolección resultó incompleta, se
 * marca así y el error original se relanza igualmente, sin tragárselo.
 */
export async function recolectarHistorico(dep: Dependencias): Promise<Resumen> {
  const maxLotes = dep.maxLotes ?? MAX_LOTES_POR_DEFECTO
  const recoleccion = dep.recoleccion ?? new Date().toISOString()
  const resumen: Resumen = {
    recoleccion,
    lotes: 0,
    eventos: 0,
    eventosBrutos: 0,
    contables: 0,
    ruido: 0,
    agotado: false,
  }
  let offset = 0

  for (let lote = 0; lote < maxLotes; lote++) {
    const cuerpo = await dep.cliente.pedirLote(offset)
    const { nEventos, agotado } = procesarPagina(dep.almacen, resumen, {
      recoleccion,
      offset,
      cuerpo,
      capturadaEn: new Date().toISOString(),
    })

    if (agotado) break
    offset += nEventos
  }

  const capturas = dep.almacen.leerCapturas(recoleccion)
  comprobarContinuidad(capturas)

  try {
    comprobarCompletitud(capturas)
  } catch (e) {
    dep.almacen.marcarCompletitud(recoleccion, false, new Date().toISOString())
    throw e
  }
  dep.almacen.marcarCompletitud(recoleccion, true, new Date().toISOString())

  return resumen
}
