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

    console.log(`Lotes recorridos: ${resumen.lotes}`)
    console.log(`Eventos totales:  ${resumen.eventos}`)
    console.log(`  contables:      ${resumen.contables}`)
    console.log(`  ruido:          ${resumen.ruido}`)

    if (resumen.agotado) {
      console.log('\nHistórico completo y continuo.')
    } else {
      console.log(
        `\nSe alcanzó el límite de ${resumen.lotes} lotes sin agotar el histórico: la recolección quedó incompleta.`,
      )
      process.exitCode = 1
    }
  } finally {
    almacen.cerrar()
  }
}

principal().catch((e: unknown) => {
  console.error(`\nRecolección detenida: ${(e as Error).message}`)
  process.exitCode = 1
})
