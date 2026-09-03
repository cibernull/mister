import { abrirAlmacen } from '../almacen/crudo.js'
import { crearCliente } from '../recoleccion/cliente.js'
import { recolectarHistorico } from '../recoleccion/recolectar.js'
import { obtenerCredenciales } from '../sesion/credenciales.js'

async function principal(): Promise<void> {
  const almacen = abrirAlmacen('datos/mister.sqlite')

  try {
    const resumen = await recolectarHistorico({
      cliente: crearCliente({ credenciales: obtenerCredenciales() }),
      almacen,
    })
    const veredicto = almacen.leerCompletitud(resumen.recoleccion)

    console.log(`Lotes recorridos: ${resumen.lotes}`)
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

principal().catch((e: unknown) => {
  console.error(`\nRecolección detenida: ${(e as Error).message}`)
  process.exitCode = 1
})
