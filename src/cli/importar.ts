import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { Almacen } from '../almacen/crudo.js'
import { abrirAlmacen } from '../almacen/crudo.js'
import { comprobarCompletitud, comprobarContinuidad } from '../recoleccion/integridad.js'
import { procesarPagina } from '../recoleccion/pagina.js'
import type { Resumen } from '../recoleccion/pagina.js'

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
 * Importa un volcado capturado en el navegador: `{ paginas: [{ offset, cuerpo, capturadaEn }] }`.
 *
 * Aplica exactamente las mismas comprobaciones que la recolección directa
 * (`recolectarHistorico`): el mismo recuento bruto de eventos por página (ver
 * `procesarPagina`/`contarEventosBrutos` en `recoleccion/pagina.ts`, la
 * lógica única y compartida entre ambas), el mismo parseo a eventos de
 * dominio, y las mismas verificaciones de continuidad y completitud al
 * final. La procedencia de los datos no relaja ninguna garantía; las filas
 * que quedan en `capturas` son indistinguibles de las que deja la
 * recolección directa, y el veredicto de completitud persistido
 * (`marcarCompletitud`) también se guarda igual.
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

  const resumen: Resumen = {
    recoleccion,
    lotes: 0,
    eventos: 0,
    eventosBrutos: 0,
    contables: 0,
    ruido: 0,
    agotado: false,
  }

  for (const pagina of paginas) {
    procesarPagina(almacen, resumen, {
      recoleccion,
      offset: pagina.offset,
      cuerpo: pagina.cuerpo,
      capturadaEn: pagina.capturadaEn,
    })
  }

  const capturas = almacen.leerCapturas(recoleccion)
  comprobarContinuidad(capturas)

  try {
    comprobarCompletitud(capturas)
  } catch (e) {
    almacen.marcarCompletitud(recoleccion, false, new Date().toISOString())
    throw e
  }
  almacen.marcarCompletitud(recoleccion, true, new Date().toISOString())

  return resumen
}

async function principal(ruta: string): Promise<void> {
  const almacen = abrirAlmacen('datos/mister.sqlite')

  try {
    const resumen = await importarVolcado(ruta, almacen)
    const veredicto = almacen.leerCompletitud(resumen.recoleccion)

    console.log(`Lotes importados: ${resumen.lotes}`)
    console.log(`Eventos brutos:   ${resumen.eventosBrutos}`)
    console.log(`Eventos totales:  ${resumen.eventos}`)
    console.log(`  contables:      ${resumen.contables}`)
    console.log(`  ruido:          ${resumen.ruido}`)
    console.log(
      `\nHistórico completo y continuo. Recolección "${resumen.recoleccion}" marcada como completa` +
        (veredicto ? ` (${veredicto.marcadaEn}).` : '.'),
    )
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
