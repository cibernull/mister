import type { Almacen } from '../almacen/crudo.js'
import { esContable } from '../dominio/eventos.js'
import type { Cliente } from './cliente.js'
import { comprobarContinuidad } from './integridad.js'
import { parsearPaginaFeed } from './parseadorFeed.js'

const MAX_LOTES_POR_DEFECTO = 500

export type Dependencias = {
  cliente: Cliente
  almacen: Almacen
  maxLotes?: number
  /** Etiqueta del recorrido. Por defecto, la marca de tiempo del arranque. */
  recoleccion?: string
}

export type Resumen = {
  recoleccion: string
  lotes: number
  eventos: number
  contables: number
  ruido: number
  /** false si se alcanzó `maxLotes` sin agotar el feed: la recolección puede estar incompleta. */
  agotado: boolean
}

/**
 * Recorre el feed desde el offset 0 hacia atrás hasta agotar el histórico.
 *
 * Guarda el crudo ANTES de interpretarlo: si una categoría no está catalogada,
 * el proceso se detiene pero el lote queda en disco para poder diagnosticarlo.
 */
export async function recolectarHistorico(dep: Dependencias): Promise<Resumen> {
  const maxLotes = dep.maxLotes ?? MAX_LOTES_POR_DEFECTO
  const recoleccion = dep.recoleccion ?? new Date().toISOString()
  const resumen: Resumen = { recoleccion, lotes: 0, eventos: 0, contables: 0, ruido: 0, agotado: false }
  let offset = 0

  for (let lote = 0; lote < maxLotes; lote++) {
    const cuerpo = await dep.cliente.pedirLote(offset)
    const nEventos = contarEventos(cuerpo)

    dep.almacen.guardarCaptura({
      recoleccion,
      offset,
      nEventos,
      cuerpo,
      capturadaEn: new Date().toISOString(),
    })
    resumen.lotes++

    const { eventos, agotado } = parsearPaginaFeed(cuerpo)

    for (const evento of eventos) {
      resumen.eventos++
      if (esContable(evento)) resumen.contables++
      else resumen.ruido++
    }

    if (agotado) {
      resumen.agotado = true
      break
    }
    offset += eventos.length
  }

  comprobarContinuidad(dep.almacen.leerCapturas(recoleccion))

  return resumen
}

/**
 * Cuenta sin interpretar, para poder guardar el crudo antes de parsearlo.
 *
 * El único caso en que falta `data` de forma legítima es el lote final real,
 * que trae `status: "end"` y ningún campo `data`. Lo que distingue ese caso
 * de una forma anómala es el `status`, nunca la ausencia de `data` por sí
 * sola: una sesión caducada (`status: "error"`, p. ej.) tampoco trae `data`,
 * y contarla como cero eventos la confundiría con el fin del histórico.
 *
 * Por eso, ante `status: "end"` se exige además que `data` esté
 * completamente ausente: si apareciera (aunque fuera vacío) sería una forma
 * que la API nunca ha producido, y contarla como cero sería descartar en
 * silencio eventos que pudiera traer.
 *
 * Para cualquier otro `status` (incluido "ok"), se exige que `data` sea un
 * array: si no lo es, es una forma inesperada y debe fallar, no contarse
 * como cero eventos.
 */
function contarEventos(cuerpo: string): number {
  const datos = JSON.parse(cuerpo) as { status?: string; data?: unknown }

  if (datos.status === 'end') {
    if (datos.data !== undefined) {
      throw new Error(
        `el lote final ("status":"end") no debería traer "data", y sin embargo lo trae (${JSON.stringify(cuerpo).slice(0, 200)})`,
      )
    }
    return 0
  }

  if (!Array.isArray(datos.data)) {
    throw new Error(
      `la respuesta del feed no tiene la forma esperada: falta el array "data" (${JSON.stringify(cuerpo).slice(0, 200)})`,
    )
  }
  return datos.data.length
}
