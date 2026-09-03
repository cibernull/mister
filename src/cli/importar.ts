import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { Almacen } from '../almacen/crudo.js'
import { abrirAlmacen } from '../almacen/crudo.js'
import { esContable } from '../dominio/eventos.js'
import { comprobarContinuidad } from '../recoleccion/integridad.js'
import { parsearPaginaFeed } from '../recoleccion/parseadorFeed.js'
import type { Resumen } from '../recoleccion/recolectar.js'

type PaginaVolcada = { offset: number; cuerpo: string; capturadaEn: string }

/** El volcado no tiene el array `paginas`, o no es un array. */
function exigirPaginas(valor: unknown): PaginaVolcada[] {
  if (!Array.isArray(valor)) {
    throw new Error(
      'el volcado no tiene la forma esperada: falta el array "paginas" (¿es un volcado-feed.json real?)',
    )
  }
  return valor as PaginaVolcada[]
}

/**
 * Cuenta los eventos BRUTOS de una página, sin interpretarlos.
 *
 * Réplica deliberada de la función homónima, no exportada, de
 * `recoleccion/recolectar.ts`: el `nEventos` guardado en el almacén debe
 * significar lo mismo venga de donde venga la página — el número de eventos
 * que el feed considera consumidos (`data.length`), NUNCA el número de
 * eventos de dominio tras parsear. Un `transfer` con varios movimientos
 * produce más eventos de dominio que eventos brutos; si aquí se contaran los
 * de dominio, el offset registrado para la siguiente página (capturado tal
 * cual por el navegador) dejaría de cuadrar con la suma acumulada y
 * `comprobarContinuidad` fallaría con un histórico en realidad completo.
 *
 * Ver la documentación de `contarEventos` en recolectar.ts para el porqué de
 * cada comprobación: el fin de histórico se decide por `status`, nunca por
 * la ausencia de `data`, para no confundir una sesión caducada con el final
 * legítimo.
 */
function contarEventosBrutos(cuerpo: string): number {
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

/**
 * Importa un volcado capturado en el navegador: `{ paginas: [{ offset, cuerpo, capturadaEn }] }`.
 *
 * Aplica exactamente las mismas comprobaciones que la recolección directa
 * (`recolectarHistorico`): el mismo recuento bruto de eventos por página, el
 * mismo parseo a eventos de dominio, y la misma verificación de continuidad
 * al final. La procedencia de los datos no relaja ninguna garantía; las
 * filas que quedan en `paginas_crudas` son indistinguibles de las que deja
 * la recolección directa.
 *
 * A diferencia de `recolectarHistorico` —que corta el recorrido en cuanto el
 * feed se agota, porque en vivo no hay nada más que pedir—, aquí se procesan
 * TODAS las páginas del fichero sin cortar al llegar a `agotado`: el volcado
 * ya es una lista cerrada, y cortar antes de tiempo aceptaría en silencio un
 * volcado con páginas sobrantes tras el fin. No hace falta una comprobación
 * aparte para rechazarlas: cualquier página tras el fin real, o bien repite
 * un offset ya guardado (el almacén ya lo rechaza como duplicado) o bien deja un
 * hueco respecto al esperado (la comprobación de continuidad lo rechaza),
 * así que el fallo llega igualmente por las mismas comprobaciones
 * compartidas, sin necesidad de una comprobación aparte.
 */
export async function importarVolcado(
  ruta: string,
  almacen: Almacen,
  recoleccion: string = `volcado:${basename(ruta)}`,
): Promise<Resumen> {
  const volcado = JSON.parse(readFileSync(ruta, 'utf8')) as { paginas?: unknown }
  const paginas = exigirPaginas(volcado.paginas)

  const resumen: Resumen = { recoleccion, lotes: 0, eventos: 0, contables: 0, ruido: 0, agotado: false }

  for (const pagina of paginas) {
    const nEventos = contarEventosBrutos(pagina.cuerpo)

    almacen.guardarCaptura({
      recoleccion,
      offset: pagina.offset,
      nEventos,
      cuerpo: pagina.cuerpo,
      capturadaEn: pagina.capturadaEn,
    })
    resumen.lotes++

    const { eventos, agotado } = parsearPaginaFeed(pagina.cuerpo)

    for (const evento of eventos) {
      resumen.eventos++
      if (esContable(evento)) resumen.contables++
      else resumen.ruido++
    }

    if (agotado) resumen.agotado = true
  }

  comprobarContinuidad(almacen.leerCapturas(recoleccion))

  return resumen
}

async function principal(ruta: string): Promise<void> {
  const almacen = abrirAlmacen('datos/mister.sqlite')

  try {
    const resumen = await importarVolcado(ruta, almacen)

    console.log(`Lotes importados: ${resumen.lotes}`)
    console.log(`Eventos totales:  ${resumen.eventos}`)
    console.log(`  contables:      ${resumen.contables}`)
    console.log(`  ruido:          ${resumen.ruido}`)

    if (resumen.agotado) {
      console.log('\nHistórico completo y continuo.')
    } else {
      console.log(
        '\nEl volcado no llega al fin del histórico ("status":"end"): la importación quedó incompleta.',
      )
      process.exitCode = 1
    }
  } finally {
    almacen.cerrar()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ruta = process.argv[2]
  if (!ruta) {
    console.error('Uso: npm run importar -- <ruta del volcado-feed.json>')
    process.exit(1)
  }

  principal(ruta).catch((e: unknown) => {
    console.error(`\nImportación detenida: ${(e as Error).message}`)
    process.exitCode = 1
  })
}
