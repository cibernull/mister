import type { Evento, Transaccion } from '../dominio/eventos.js'
import type { PuntoValor } from '../recoleccion/parseadorValores.js'
import { valorEn } from '../recoleccion/parseadorValores.js'
import type { RepartoEquipo } from './reparto.js'

export type EntradaMotor = {
  eventos: Evento[]
  repartos: Map<number, RepartoEquipo>
  /** idJugador -> su serie diaria de valor. */
  valores: Map<number, PuntoValor[]>
  /** ISO `YYYY-MM-DD` del reinicio de la liga. */
  fechaReinicio: string
  presupuestoInicial: number
  coeficienteTope: number
  /** idUc -> valor de plantilla actual, para el tope de puja. */
  valorPlantillaActual: Map<number, number>
  /** Corte temporal, para calcular el estado en una fecha pasada. */
  hasta?: string
}

export type EstadoEquipo = {
  idUc: number
  nombre: string
  valorReparto: number
  saldoInicial: number
  premios: number
  ventas: number
  compras: number
  saldo: number
  topePuja: number
  /** Jugadores del reparto sin valor conocido en la fecha del reinicio. */
  jugadoresSinValor: number[]
}

/**
 * Calcula el estado financiero de cada equipo.
 *
 * Función pura: sin red, sin base de datos, sin reloj.
 *
 *   saldo inicial = presupuesto − valor del reparto el día del reinicio
 *   saldo         = saldo inicial + premios + ventas − compras
 *   tope de puja  = saldo + coeficiente × valor de plantilla actual
 *
 * A un jugador sin valor conocido NO se le asigna cero: se declara en
 * `jugadoresSinValor`, porque un cero silencioso infla el saldo inicial y
 * produce una cifra plausible y equivocada.
 *
 * Por la misma razón, un evento contable que referencia un `idUc` ausente de
 * `repartos`, o un equipo de `repartos` ausente de `valorPlantillaActual`,
 * lanzan en vez de ignorarse o rellenarse con cero: son formas inesperadas de
 * la entrada, no casos de negocio a degradar en silencio.
 */
export function calcularEstado(entrada: EntradaMotor): Map<number, EstadoEquipo> {
  const estados = new Map<number, EstadoEquipo>()

  for (const [idUc, reparto] of entrada.repartos) {
    let valorReparto = 0
    const sinValor: number[] = []

    for (const idJugador of reparto.jugadores) {
      const serie = entrada.valores.get(idJugador)
      const valor = serie ? valorEn(serie, entrada.fechaReinicio) : null
      if (valor === null) sinValor.push(idJugador)
      else valorReparto += valor
    }

    const saldoInicial = entrada.presupuestoInicial - valorReparto

    estados.set(idUc, {
      idUc,
      nombre: reparto.nombre,
      valorReparto,
      saldoInicial,
      premios: 0,
      ventas: 0,
      compras: 0,
      saldo: saldoInicial,
      topePuja: 0,
      jugadoresSinValor: sinValor,
    })
  }

  const equipoDe = (idUc: number, contexto: string): EstadoEquipo => {
    const e = estados.get(idUc)
    if (!e) {
      throw new Error(`${contexto} referencia al equipo ${idUc}, que no está en el reparto de la liga`)
    }
    return e
  }

  const dentroDePlazo = (fecha: string) => !entrada.hasta || fecha <= entrada.hasta

  for (const evento of entrada.eventos) {
    if (!dentroDePlazo(evento.fecha)) continue

    if (evento.tipo === 'transaccion') {
      const t = evento as Transaccion
      if (t.origen.clase === 'equipo') {
        equipoDe(t.origen.idUc, `la venta del jugador ${t.idJugador} (evento ${t.idEvento})`).ventas += t.importe
      }
      if (t.destino.clase === 'equipo') {
        equipoDe(t.destino.idUc, `la compra del jugador ${t.idJugador} (evento ${t.idEvento})`).compras += t.importe
      }
      continue
    }

    if (evento.tipo === 'cierreJornada') {
      for (const r of evento.resultados) {
        equipoDe(r.idUc, `el premio de la jornada ${evento.jornada} (evento ${evento.idEvento})`).premios += r.premio
      }
    }
  }

  for (const e of estados.values()) {
    e.saldo = e.saldoInicial + e.premios + e.ventas - e.compras
    if (!entrada.valorPlantillaActual.has(e.idUc)) {
      throw new Error(`el equipo ${e.idUc} está en el reparto pero no tiene valor de plantilla actual`)
    }
    const plantilla = entrada.valorPlantillaActual.get(e.idUc)!
    e.topePuja = e.saldo + Math.round(entrada.coeficienteTope * plantilla)
  }

  return estados
}

export type ResultadoValorPlantillas = {
  /** idUc -> valor de plantilla actual, listo para `EntradaMotor.valorPlantillaActual`. */
  valorPlantillaActual: Map<number, number>
  /**
   * idUc -> jugadores de su plantilla ACTUAL sin serie de valores conocida.
   * EXCLUIDOS de la suma, nunca contados como cero (ver la nota de más abajo).
   */
  jugadoresSinValorActual: Map<number, number[]>
}

/**
 * Valor de la plantilla actual de cada equipo: la suma del último valor
 * conocido de cada uno de sus jugadores de hoy (no el valor en la fecha del
 * reinicio, que es lo que usa `valorReparto` más arriba).
 *
 * Un jugador sin serie de valores no cuenta como cero: se excluye de la suma
 * y se declara en `jugadoresSinValorActual`, por la misma razón que ya
 * documenta esta función más arriba para `jugadoresSinValor` — un cero
 * silencioso produce un tope de puja plausible y equivocado. Antes de que
 * quien llama a esta función pidiera la ficha de TODOS los jugadores de la
 * plantilla actual (y no solo los del reparto), esta rama se activaba para
 * cualquier jugador comprado y todavía en plantilla: su ficha nunca se había
 * pedido, `valores.get(id)` no existía, y su valor contaba cero sin que nada
 * lo dijera (hallazgo Crítico 1). Con las fichas ya pedidas, esta lista
 * debería quedar vacía en el uso normal; se conserva como red de seguridad
 * declarada, no como salto silencioso.
 */
export function calcularValorPlantillaActual(
  plantillas: Map<number, number[]>,
  valores: Map<number, PuntoValor[]>,
): ResultadoValorPlantillas {
  const valorPlantillaActual = new Map<number, number>()
  const jugadoresSinValorActual = new Map<number, number[]>()

  for (const [idUc, jugadores] of plantillas) {
    let total = 0
    const sinValor: number[] = []

    for (const id of jugadores) {
      const serie = valores.get(id)
      if (serie && serie.length) total += serie[serie.length - 1]!.valor
      else sinValor.push(id)
    }

    valorPlantillaActual.set(idUc, total)
    if (sinValor.length) jugadoresSinValorActual.set(idUc, sinValor)
  }

  return { valorPlantillaActual, jugadoresSinValorActual }
}
