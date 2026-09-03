import { abrirAlmacen } from '../almacen/crudo.js'
import { leerAsignaciones } from '../contabilidad/asignaciones.js'
import { deduplicar } from '../contabilidad/deduplicar.js'
import { calcularEstado } from '../contabilidad/motor.js'
import { bajasSinDuenio, reconstruirRepartos } from '../contabilidad/reparto.js'
import {
  verificarMarcasNegativas, verificarSaldoPropio, verificarTopePropio,
} from '../contabilidad/verificacion.js'
import type { Evento } from '../dominio/eventos.js'
import { recolectarAuxiliares, rutaEquipo, rutaJugador } from '../recoleccion/auxiliares.js'
import { crearCliente } from '../recoleccion/cliente.js'
import { parsearFgUser } from '../recoleccion/parseadorFgUser.js'
import { parsearPaginaFeed } from '../recoleccion/parseadorFeed.js'
import { parsearPlantilla } from '../recoleccion/parseadorPlantilla.js'
import { parsearSerieValores } from '../recoleccion/parseadorValores.js'
import { obtenerCredenciales } from '../sesion/credenciales.js'

// Parámetros de esta liga, con su procedencia.
const FECHA_REINICIO = '2026-08-03'      // evento admin `reset-all` del histórico
const PRESUPUESTO_INICIAL = 50_000_000   // aportado por el usuario, verificado
const COEFICIENTE_TOPE = 0.25            // verificado contra maxDebt al euro
const RUTA_ASIGNACIONES = 'datos/bajas-asignadas.json'

const eur = (n: number) => Math.round(n).toLocaleString('es-ES') + ' €'

async function principal(): Promise<void> {
  const almacen = abrirAlmacen('datos/mister.sqlite')

  try {
    // 1. Histórico ya recolectado -> eventos deduplicados.
    const completas = almacen.recolecciones().filter((r) => almacen.leerCompletitud(r))
    const recoleccion = completas[completas.length - 1]
    if (!recoleccion) {
      throw new Error('no hay ninguna recolección completa. Ejecuta antes `npm run recolectar` o `npm run importar`.')
    }

    const eventos: Evento[] = deduplicar(
      almacen.leerCapturas(recoleccion).flatMap((c) => parsearPaginaFeed(c.cuerpo).eventos),
    )

    // 2. Equipos y jugadores implicados.
    const idsUc = new Set<number>()
    const idsJugador = new Set<number>()
    for (const e of eventos) {
      if (e.tipo === 'transaccion') {
        if (e.origen.clase === 'equipo') idsUc.add(e.origen.idUc)
        if (e.destino.clase === 'equipo') idsUc.add(e.destino.idUc)
        idsJugador.add(e.idJugador)
      } else if (e.tipo === 'cierreJornada') {
        for (const r of e.resultados) idsUc.add(r.idUc)
      } else if (e.tipo === 'bajaPlantilla') {
        idsJugador.add(e.idJugador)
      }
    }

    // 3. Plantillas actuales (una pasada) y luego los jugadores que aporten.
    const cliente = crearCliente({ credenciales: obtenerCredenciales() })
    await recolectarAuxiliares({ cliente, almacen, idsUc: [...idsUc], idsJugador: [] })

    const plantillas = new Map<number, number[]>()
    for (const idUc of idsUc) {
      const pagina = almacen.leerPagina(rutaEquipo(idUc))
      if (!pagina) throw new Error(`falta la plantilla del equipo ${idUc}`)
      const jugadores = parsearPlantilla(pagina.cuerpo)
      plantillas.set(idUc, jugadores)
      for (const id of jugadores) idsJugador.add(id)
    }

    // Las bajas sin dueño identificable son un dato de entrada que aporta la
    // persona: sin él, esos jugadores no entran en ningún reparto inicial, y
    // eso es correcto (ver bajasSinDuenio más abajo, que lo declara).
    const asignaciones = leerAsignaciones(RUTA_ASIGNACIONES)
    const repartos = reconstruirRepartos(eventos, plantillas, asignaciones)
    const necesarios = [...new Set([...repartos.values()].flatMap((r) => r.jugadores))]
    const aux = await recolectarAuxiliares({ cliente, almacen, idsUc: [], idsJugador: necesarios })
    console.log(`Fichas de jugador: ${aux.jugadores} descargadas, ${aux.yaEnCache} ya guardadas\n`)

    // 4. Series de valor y valor de plantilla actual.
    const valores = new Map<number, ReturnType<typeof parsearSerieValores>>()
    for (const id of necesarios) {
      const pagina = almacen.leerPagina(rutaJugador(id))
      if (!pagina) throw new Error(`falta la ficha del jugador ${id}`)
      valores.set(id, parsearSerieValores(pagina.cuerpo))
    }

    const valorPlantillaActual = new Map<number, number>()
    for (const [idUc, jugadores] of plantillas) {
      let total = 0
      for (const id of jugadores) {
        const serie = valores.get(id)
        if (serie && serie.length) total += serie[serie.length - 1]!.valor
      }
      valorPlantillaActual.set(idUc, total)
    }

    const comun = {
      eventos, repartos, valores,
      fechaReinicio: FECHA_REINICIO,
      presupuestoInicial: PRESUPUESTO_INICIAL,
      coeficienteTope: COEFICIENTE_TOPE,
      valorPlantillaActual,
    }

    // 5. Estado actual.
    const estados = calcularEstado(comun)
    const orden = [...estados.values()].sort((a, b) => b.topePuja - a.topePuja)

    console.log('Equipo'.padEnd(32) + 'Saldo'.padStart(16) + 'Tope de puja'.padStart(17))
    console.log('-'.repeat(65))
    for (const e of orden) {
      console.log(e.nombre.padEnd(32) + eur(e.saldo).padStart(16) + eur(e.topePuja).padStart(17))
    }

    // 6. Las tres verificaciones.
    const paginaPropia = almacen.leerPagina(rutaEquipo([...idsUc][0]!))!
    const propios = parsearFgUser(paginaPropia.cuerpo)
    const mio = estados.get(propios.idUc)
    if (!mio) throw new Error('el motor no calculó el estado del equipo propio')

    console.log('\nVerificación')
    for (const d of [verificarSaldoPropio(mio, propios), verificarTopePropio(mio, propios)]) {
      if (!d) console.log('  ✓ coincide al euro')
      else console.log(`  ${d.concepto}: calculado ${eur(d.calculado)}, real ${eur(d.real)}, desvío ${eur(d.desvio)}`)
    }

    const marcas = verificarMarcasNegativas(eventos, (hasta) => calcularEstado({ ...comun, hasta }))
    console.log(`  marcas de saldo negativo: ${marcas.aciertos} aciertos, ${marcas.fallos} fallos`)
    for (const f of marcas.detalle) {
      console.log(`    J${f.jornada} ${f.equipo}: calculado ${eur(f.saldoCalculado)}, Mister dice ${f.misterDiceNegativo ? 'negativo' : 'no negativo'}`)
    }

    // 7. Incertidumbre declarada, nunca disimulada.
    const sinValor = orden.filter((e) => e.jugadoresSinValor.length)
    if (sinValor.length) {
      console.log('\nJugadores del reparto sin valor conocido en la fecha del reinicio:')
      for (const e of sinValor) console.log(`  ${e.nombre}: ${e.jugadoresSinValor.join(', ')}`)
    }

    const sinDuenio = bajasSinDuenio(eventos, repartos)
    if (sinDuenio.length) {
      console.log('\nBajas de plantilla sin dueño identificable en ninguna fuente:')
      console.log(`  ${sinDuenio.join(', ')}`)
      console.log(`  Añádelos a ${RUTA_ASIGNACIONES} si se les puede atribuir un equipo.`)
    }
  } finally {
    almacen.cerrar()
  }
}

principal().catch((e: unknown) => {
  console.error(`\nAnálisis detenido: ${(e as Error).message}`)
  process.exitCode = 1
})
