import type { VeredictoRecoleccion } from '../almacen/crudo.js'
import { abrirAlmacen } from '../almacen/crudo.js'
import { leerAsignaciones } from '../contabilidad/asignaciones.js'
import { deduplicar } from '../contabilidad/deduplicar.js'
import { calcularEstado, calcularValorPlantillaActual } from '../contabilidad/motor.js'
import { bajasSinDuenio, reconstruirRepartos } from '../contabilidad/reparto.js'
import {
  verificarMarcasNegativas, verificarSaldoPropio, verificarTopePropio,
} from '../contabilidad/verificacion.js'
import type { Evento, Ruido } from '../dominio/eventos.js'
import { recolectarAuxiliares, rutaEquipo, rutaJugador } from '../recoleccion/auxiliares.js'
import { crearCliente } from '../recoleccion/cliente.js'
import { parsearFgUser } from '../recoleccion/parseadorFgUser.js'
import { parsearPaginaFeed } from '../recoleccion/parseadorFeed.js'
import { parsearPlantilla } from '../recoleccion/parseadorPlantilla.js'
import { parsearSerieValores } from '../recoleccion/parseadorValores.js'
import { obtenerCredenciales } from '../sesion/credenciales.js'

// Parámetros de esta liga, con su procedencia.
const FECHA_REINICIO = '2026-08-03'      // evento admin `reset-all` del histórico; ver verificarFechaReinicio
const PRESUPUESTO_INICIAL = 50_000_000   // aportado por el usuario, verificado
const COEFICIENTE_TOPE = 0.25            // verificado contra maxDebt al euro
const RUTA_ASIGNACIONES = 'datos/bajas-asignadas.json'

/**
 * Umbral a partir del cual el desfase entre el instante del histórico y el
 * de los datos auxiliares se avisa de forma destacada (ver `chequearInstantes`
 * y el hallazgo Importante 4).
 *
 * Se reutiliza la misma magnitud —12 horas— que ya usa la caducidad de la
 * caché de auxiliares (`recolectarAuxiliares`, en `recoleccion/auxiliares.ts`):
 * ese es el margen que el propio proyecto ya considera "todavía fresco" para
 * una plantilla, un valor o un `_FG_user`. Un desfase mayor entre el instante
 * del histórico y el más antiguo de esos datos auxiliares implica que, aunque
 * cada dato auxiliar individualmente esté "fresco" según ese mismo criterio,
 * el conjunto ya no describe un único momento coherente. No se importa la
 * constante de `auxiliares.ts` porque es interna de esa capa (no exportada) y
 * este fichero es el único de los tocados en esta corrección; se documenta
 * aquí la coincidencia deliberada en vez de duplicar sin explicar.
 */
const UMBRAL_DESFASE_INSTANTES_MS = 12 * 60 * 60 * 1000

const eur = (n: number) => Math.round(n).toLocaleString('es-ES') + ' €'

/**
 * Candidato a "la" recolección con la que trabajar: su nombre y su veredicto
 * de completitud, si lo tiene.
 */
export type CandidatoRecoleccion = {
  nombre: string
  veredicto: VeredictoRecoleccion | undefined
}

/**
 * Elige con qué recolección trabajar.
 *
 * Dos reglas, las dos verificadas contra hallazgos reales de la revisión:
 *
 *  - Solo cuentan las recolecciones cuyo veredicto es `completa === true`
 *    (Crítico 2): `leerCompletitud` devuelve un objeto, y `{ completa: false }`
 *    es un valor truthy en JavaScript. Un filtro que comprobara solo
 *    "¿hay veredicto?" en vez de "¿el veredicto dice completa?" dejaría pasar
 *    un histórico truncado sin decir nada.
 *  - Entre las completas, se elige la de `marcadaEn` más reciente, NUNCA por
 *    orden alfabético del nombre (Importante 3): las recolecciones en vivo se
 *    llaman con una marca ISO (`2026-...`) y las importaciones
 *    `volcado:<fichero>`; como `"v" > "2"`, ordenar por nombre hace que
 *    cualquier volcado manual gane siempre a toda recolección en vivo, por
 *    antigua que sea.
 *
 * Lanza si ninguna recolección es completa, indicando cuántas hay
 * incompletas para que se entienda qué está pasando.
 */
export function elegirRecoleccion(candidatos: CandidatoRecoleccion[]): string {
  const completas = candidatos.filter(
    (c): c is { nombre: string; veredicto: VeredictoRecoleccion } => c.veredicto?.completa === true,
  )

  if (completas.length === 0) {
    const n = candidatos.length
    throw new Error(
      `no hay ninguna recolección completa (${n} incompleta${n === 1 ? '' : 's'} en el almacén). ` +
        'Ejecuta antes `npm run recolectar` o `npm run importar`.',
    )
  }

  return completas.reduce((mejor, c) => (c.veredicto.marcadaEn > mejor.veredicto.marcadaEn ? c : mejor)).nombre
}

/**
 * Jugadores cuya ficha (serie de valores) hace falta descargar.
 *
 * La unión de dos fuentes, no solo una (Crítico 1):
 *  - todo `idJugador` mencionado en el histórico (transacciones y bajas de
 *    plantilla): son los candidatos a haber sido parte de un reparto inicial;
 *  - todos los jugadores de todas las plantillas actuales.
 *
 * Antes de esta función, `necesarios` solo era la unión de los repartos, y un
 * jugador COMPRADO y todavía en plantilla no pertenece a ningún reparto
 * inicial (`reconstruirRepartos` lo excluye a propósito: lo compró, no lo
 * heredó). Su ficha nunca se pedía, así que su valor de plantilla actual
 * contaba cero en silencio — y de ahí un tope de puja equivocado para los
 * ocho equipos, la cifra sobre la que se deciden las pujas.
 */
export function jugadoresNecesarios(eventos: Evento[], plantillas: Map<number, number[]>): number[] {
  const ids = new Set<number>()

  for (const e of eventos) {
    if (e.tipo === 'transaccion' || e.tipo === 'bajaPlantilla') ids.add(e.idJugador)
  }
  for (const jugadores of plantillas.values()) {
    for (const id of jugadores) ids.add(id)
  }

  return [...ids]
}

export type ChequeoInstantes = {
  /** El más reciente de los instantes de captura del histórico usado. */
  instanteHistorico: string
  /** El más antiguo de los instantes de captura de los datos auxiliares. */
  instanteAuxiliarMasAntiguo: string
  desfaseMs: number
  /** true si el desfase supera `UMBRAL_DESFASE_INSTANTES_MS`. */
  destacar: boolean
}

/**
 * Contrasta el instante del histórico contra el de los datos auxiliares
 * (Importante 4).
 *
 * Los eventos salen de una recolección que puede tardar días; las
 * plantillas, los valores y `_FG_user` tienen como mucho 12 horas de
 * antigüedad (los renueva la caché de `recolectarAuxiliares`). La ecuación
 * contable mezcla ambos instantes sin decirlo: un fichaje ocurrido entre uno
 * y otro hace que "coincide al euro" compare un saldo de ahora contra un
 * histórico de antes, sin ningún aviso.
 *
 * Se usa el MÁS RECIENTE de los instantes del histórico (el que mejor
 * aproxima "hasta cuándo llega este relato") contra el MÁS ANTIGUO de los
 * auxiliares (el peor caso: el dato más rezagado del lote).
 */
export function chequearInstantes(
  capturadaEnHistorico: string[],
  capturadaEnAuxiliares: string[],
): ChequeoInstantes {
  if (capturadaEnHistorico.length === 0) {
    throw new Error('no hay ninguna captura del histórico con la que contrastar instantes')
  }
  if (capturadaEnAuxiliares.length === 0) {
    throw new Error('no hay ninguna página auxiliar con la que contrastar instantes')
  }

  const instanteHistorico = capturadaEnHistorico.reduce((a, b) => (b > a ? b : a))
  const instanteAuxiliarMasAntiguo = capturadaEnAuxiliares.reduce((a, b) => (b < a ? b : a))

  const tHistorico = Date.parse(instanteHistorico)
  const tAuxiliar = Date.parse(instanteAuxiliarMasAntiguo)
  if (Number.isNaN(tHistorico) || Number.isNaN(tAuxiliar)) {
    throw new Error(
      `instante ilegible al contrastar histórico y auxiliares: ${JSON.stringify({ instanteHistorico, instanteAuxiliarMasAntiguo })}`,
    )
  }

  const desfaseMs = Math.abs(tHistorico - tAuxiliar)
  return {
    instanteHistorico,
    instanteAuxiliarMasAntiguo,
    desfaseMs,
    destacar: desfaseMs > UMBRAL_DESFASE_INSTANTES_MS,
  }
}

export type VerificacionFechaReinicio =
  | { verificable: false }
  | { verificable: true; fechaHallada: string; coincide: boolean }

/** Motivo exacto que `parsearPaginaFeed` asigna a un evento `admin` (ver `CATEGORIAS_RUIDO` en `parseadorFeed.ts`). */
const MOTIVO_RUIDO_ADMIN = 'categoría sin efecto contable: admin'

/**
 * Contrasta `FECHA_REINICIO` contra los datos (Importante 10).
 *
 * Su origen real es el evento `admin` con `key: "reset-all"`, pero el
 * dominio aplana cualquier evento `admin` a `Ruido`, conservando la
 * categoría (en `motivo`) pero no la `key` original: no hay forma de
 * distinguir, desde un `Evento`, un `reset-all` de cualquier otro evento
 * administrativo (activar/desactivar el capitán, etc.) sin tocar el dominio.
 *
 * La vía más barata sin tocarlo: el evento `admin` MÁS ANTIGUO del
 * histórico. En los datos reales de esta liga es efectivamente el
 * `reset-all` (el único otro evento `admin` observado es muy posterior), pero
 * esto es una aproximación, no una identificación certera — en una liga
 * distinta, un evento administrativo anterior al reinicio la invalidaría.
 * Por eso el resultado se declara `verificable` o no, y quien llame debe
 * avisar de forma destacada en ambos casos de duda (ver el informe).
 */
export function verificarFechaReinicio(eventos: Evento[], fechaReinicio: string): VerificacionFechaReinicio {
  const admins = eventos.filter((e): e is Ruido => e.tipo === 'ruido' && e.motivo === MOTIVO_RUIDO_ADMIN)
  if (admins.length === 0) return { verificable: false }

  const masAntiguo = admins.reduce((a, b) => (b.fecha < a.fecha ? b : a))
  const fechaHallada = masAntiguo.fecha.slice(0, 10)
  return { verificable: true, fechaHallada, coincide: fechaHallada === fechaReinicio }
}

async function principal(): Promise<void> {
  const almacen = abrirAlmacen('datos/mister.sqlite')

  try {
    // 1. Elegir la recolección y obtener el histórico ya deduplicado.
    const candidatos: CandidatoRecoleccion[] = almacen
      .recolecciones()
      .map((nombre) => ({ nombre, veredicto: almacen.leerCompletitud(nombre) }))
    const recoleccion = elegirRecoleccion(candidatos)

    const capturas = almacen.leerCapturas(recoleccion)
    const eventos: Evento[] = deduplicar(capturas.flatMap((c) => parsearPaginaFeed(c.cuerpo).eventos))

    // 2. Equipos implicados, para pedir sus plantillas actuales.
    const idsUc = new Set<number>()
    for (const e of eventos) {
      if (e.tipo === 'transaccion') {
        if (e.origen.clase === 'equipo') idsUc.add(e.origen.idUc)
        if (e.destino.clase === 'equipo') idsUc.add(e.destino.idUc)
      } else if (e.tipo === 'cierreJornada') {
        for (const r of e.resultados) idsUc.add(r.idUc)
      }
    }

    // 3. Plantillas actuales (una pasada), guardando el instante de cada
    //    página leída para el chequeo de instantes del paso 5.
    const cliente = crearCliente({ credenciales: obtenerCredenciales() })
    await recolectarAuxiliares({ cliente, almacen, idsUc: [...idsUc], idsJugador: [] })

    const capturadaEnAuxiliares: string[] = []
    const plantillas = new Map<number, number[]>()
    for (const idUc of idsUc) {
      const pagina = almacen.leerPagina(rutaEquipo(idUc))
      if (!pagina) throw new Error(`falta la plantilla del equipo ${idUc}`)
      capturadaEnAuxiliares.push(pagina.capturadaEn)
      // `parsearPlantilla` ahora también trae el slug de cada jugador (para
      // que la Fase 3 pueda buscarlos por nombre), pero el reparto y el
      // valor de plantilla de este módulo solo necesitan el id: se proyecta
      // aquí mismo, en la frontera, en vez de propagar el tipo más allá de
      // lo que este cambio exige.
      plantillas.set(idUc, parsearPlantilla(pagina.cuerpo).map((j) => j.idJugador))
    }

    // Las bajas sin dueño identificable son un dato de entrada que aporta la
    // persona: sin él, esos jugadores no entran en ningún reparto inicial, y
    // eso es correcto (ver bajasSinDuenio más abajo, que lo declara).
    const asignaciones = leerAsignaciones(RUTA_ASIGNACIONES)
    const repartos = reconstruirRepartos(eventos, plantillas, asignaciones)

    // 4. Fichas de jugador: reparto Y plantillas actuales (Crítico 1).
    const necesarios = jugadoresNecesarios(eventos, plantillas)
    const aux = await recolectarAuxiliares({ cliente, almacen, idsUc: [], idsJugador: necesarios })
    console.log(`Fichas de jugador: ${aux.jugadores} descargadas, ${aux.yaEnCache} ya guardadas\n`)

    const valores = new Map<number, ReturnType<typeof parsearSerieValores>>()
    for (const id of necesarios) {
      const pagina = almacen.leerPagina(rutaJugador(id))
      if (!pagina) throw new Error(`falta la ficha del jugador ${id}`)
      capturadaEnAuxiliares.push(pagina.capturadaEn)
      valores.set(id, parsearSerieValores(pagina.cuerpo))
    }

    const { valorPlantillaActual, jugadoresSinValorActual } = calcularValorPlantillaActual(plantillas, valores)

    const comun = {
      eventos, repartos, valores,
      fechaReinicio: FECHA_REINICIO,
      presupuestoInicial: PRESUPUESTO_INICIAL,
      coeficienteTope: COEFICIENTE_TOPE,
      valorPlantillaActual,
    }

    // 5. Estado actual y las tres verificaciones — TODO esto ANTES de
    //    imprimir nada (Importante 8): ninguna cifra se muestra sin que ya
    //    se sepa si está validada.
    const estados = calcularEstado(comun)
    const orden = [...estados.values()].sort((a, b) => b.topePuja - a.topePuja)

    const paginaPropia = almacen.leerPagina(rutaEquipo([...idsUc][0]!))!
    const propios = parsearFgUser(paginaPropia.cuerpo)
    const mio = estados.get(propios.idUc)
    if (!mio) throw new Error('el motor no calculó el estado del equipo propio')

    const discSaldo = verificarSaldoPropio(mio, propios)
    const discTope = verificarTopePropio(mio, propios)
    const marcas = verificarMarcasNegativas(eventos, (hasta) => calcularEstado({ ...comun, hasta }))
    // El tope de puja es la cifra sobre la que se deciden las pujas, pero un
    // saldo propio que no cuadra ya es, por sí solo, una cifra equivocada:
    // "una cifra equivocada es peor que ninguna" no distingue cuál de las dos.
    const noValidado = discSaldo !== null || discTope !== null

    const instantes = chequearInstantes(
      capturas.map((c) => c.capturadaEn),
      capturadaEnAuxiliares,
    )
    const verificacionFecha = verificarFechaReinicio(eventos, FECHA_REINICIO)

    // 6. La salida, ya con todo verificado.
    console.log(`Instante del histórico (recolección "${recoleccion}"): ${instantes.instanteHistorico}`)
    console.log(`Instante más antiguo de los datos auxiliares:          ${instantes.instanteAuxiliarMasAntiguo}`)
    if (instantes.destacar) {
      const horas = (instantes.desfaseMs / 3_600_000).toFixed(1)
      const umbralHoras = UMBRAL_DESFASE_INSTANTES_MS / 3_600_000
      console.log(
        `\n⚠ AVISO: el histórico y los datos auxiliares están desfasados ${horas} h ` +
          `(umbral: ${umbralHoras} h). Un fichaje ocurrido entre ambos instantes puede hacer ` +
          'que la ecuación no cuadre sin que eso sea un error del motor.',
      )
    }

    if (!verificacionFecha.verificable) {
      console.log(
        '\n⚠ AVISO: FECHA_REINICIO no se ha podido verificar contra los datos: ' +
          'no hay ningún evento "admin" en el histórico usado.',
      )
    } else if (!verificacionFecha.coincide) {
      console.log(
        `\n⚠ AVISO: FECHA_REINICIO (${FECHA_REINICIO}) no coincide con el evento admin más antiguo ` +
          `del histórico (${verificacionFecha.fechaHallada}). Revisa la constante.`,
      )
    }

    if (noValidado) {
      console.log('\n*** SALIDA NO VALIDADA: el saldo o el tope de puja propios no coinciden al euro con Mister ***')
    }

    console.log('\n' + 'Equipo'.padEnd(32) + 'Saldo'.padStart(16) + 'Tope de puja'.padStart(17))
    console.log('-'.repeat(65))
    for (const e of orden) {
      console.log(e.nombre.padEnd(32) + eur(e.saldo).padStart(16) + eur(e.topePuja).padStart(17))
    }

    console.log('\nVerificación')
    for (const d of [discSaldo, discTope]) {
      if (!d) console.log('  ✓ coincide al euro')
      else console.log(`  ${d.concepto}: calculado ${eur(d.calculado)}, real ${eur(d.real)}, desvío ${eur(d.desvio)}`)
    }
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

    if (jugadoresSinValorActual.size) {
      console.log('\nJugadores de la plantilla ACTUAL sin valor conocido (excluidos del total, no cuentan cero):')
      for (const [idUc, ids] of jugadoresSinValorActual) {
        const nombre = estados.get(idUc)?.nombre ?? String(idUc)
        console.log(`  ${nombre}: ${ids.join(', ')}`)
      }
    }

    // Qué parte del reparto de cada equipo viene de una asignación manual
    // (datos/bajas-asignadas.json), para que se vea qué parte del cuadre es
    // circular cuando ese fichero ajusta un término contra la misma
    // verificación que se presenta aquí como independiente (Importante 9).
    const nombreDeBaja = new Map<number, string>()
    for (const e of eventos) if (e.tipo === 'bajaPlantilla') nombreDeBaja.set(e.idJugador, e.jugador)
    const conAsignacionManual = [...repartos.values()].filter((r) => r.porBaja.length > 0)
    if (conAsignacionManual.length) {
      console.log(`\nJugadores del reparto que proceden de una asignación manual (${RUTA_ASIGNACIONES}):`)
      for (const r of conAsignacionManual) {
        console.log(`  ${r.nombre}: ${r.porBaja.map((id) => nombreDeBaja.get(id) ?? String(id)).join(', ')}`)
      }
    }

    const sinDuenio = bajasSinDuenio(eventos, repartos)
    if (sinDuenio.length) {
      console.log('\nBajas de plantilla sin dueño identificable en ninguna fuente:')
      console.log(`  ${sinDuenio.join(', ')}`)
      console.log(`  Añádelos a ${RUTA_ASIGNACIONES} si se les puede atribuir un equipo.`)
    }

    if (noValidado) process.exitCode = 1
  } finally {
    almacen.cerrar()
  }
}

// Igual que en `importar.ts`: solo se ejecuta como CLI, nunca al importar
// este módulo — así los tests pueden importar `elegirRecoleccion`,
// `jugadoresNecesarios`, `chequearInstantes` y `verificarFechaReinicio` sin
// disparar `principal()` (que abre el almacén real y pide credenciales).
if (import.meta.url === `file://${process.argv[1]}`) {
  principal().catch((e: unknown) => {
    console.error(`\nAnálisis detenido: ${(e as Error).message}`)
    process.exitCode = 1
  })
}
