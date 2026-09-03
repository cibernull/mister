import type { Almacen } from '../almacen/crudo.js'
import { esContable } from '../dominio/eventos.js'
import { parsearPaginaFeed } from './parseadorFeed.js'

export type Resumen = {
  recoleccion: string
  lotes: number
  eventos: number
  /**
   * Recuento de eventos BRUTOS consumidos del feed (suma de `nEventos` de
   * cada lote): la cifra que debe cuadrar con el offset final, a diferencia
   * de `eventos`, que cuenta eventos de dominio ya expandidos (ver
   * `contarEventosBrutos`).
   */
  eventosBrutos: number
  contables: number
  ruido: number
  /** false si se alcanzó `maxLotes` sin agotar el feed: la recolección puede estar incompleta. */
  agotado: boolean
}

/** Un lote ya obtenido (en vivo o desde un volcado), listo para guardar y parsear. */
export type Pagina = {
  /** Etiqueta del recorrido al que pertenece este lote. */
  recoleccion: string
  offset: number
  cuerpo: string
  capturadaEn: string
}

export type ResultadoPagina = {
  /** Recuento de eventos brutos de este lote, tal y como los cuenta el feed. */
  nEventos: number
  /** true si este lote es el marcador de fin del feed. */
  agotado: boolean
}

/**
 * Guarda el crudo de un lote (ANTES de interpretarlo) y acumula sus eventos
 * de dominio sobre `resumen`.
 *
 * Camino común a la recolección en vivo (`recolectarHistorico`) y a la
 * importación de un volcado del navegador (`importarVolcado`): ambas rutas
 * deben guardar→parsear→contar exactamente igual, para que una fila de
 * `capturas` signifique lo mismo venga de donde venga. Este bucle, y el
 * recuento bruto de `contarEventosBrutos`, vivían duplicados en los dos
 * ficheros; esa duplicación fue la causa directa de un bug crítico (el
 * recolector avanzaba el offset con eventos de dominio en vez de brutos,
 * mientras el importador —con la copia correcta a diez metros— hacía lo
 * debido). Ahora solo hay una fuente.
 */
export function procesarPagina(almacen: Almacen, resumen: Resumen, pagina: Pagina): ResultadoPagina {
  const nEventos = contarEventosBrutos(pagina.cuerpo)

  almacen.guardarCaptura({
    recoleccion: pagina.recoleccion,
    offset: pagina.offset,
    nEventos,
    cuerpo: pagina.cuerpo,
    capturadaEn: pagina.capturadaEn,
  })
  resumen.lotes++
  resumen.eventosBrutos += nEventos

  const { eventos, agotado } = parsearPaginaFeed(pagina.cuerpo)

  for (const evento of eventos) {
    resumen.eventos++
    if (esContable(evento)) resumen.contables++
    else resumen.ruido++
  }

  if (agotado) resumen.agotado = true

  return { nEventos, agotado }
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
 *
 * El resultado es el recuento BRUTO de eventos consumidos por el feed
 * (`data.length`), NUNCA el número de eventos de dominio tras parsear: un
 * `transfer` con varios movimientos produce más eventos de dominio que
 * eventos brutos, y el offset del feed avanza por los segundos, no por los
 * primeros. Confundirlos hace que la siguiente página se pida en el offset
 * equivocado y se salten eventos reales del feed en silencio.
 */
export function contarEventosBrutos(cuerpo: string): number {
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
