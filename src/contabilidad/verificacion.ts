import type { EstadoEquipo } from './motor.js'
import type { DatosUsuario } from '../recoleccion/parseadorFgUser.js'
import type { Evento } from '../dominio/eventos.js'

export type Discrepancia = {
  concepto: string
  calculado: number
  real: number
  /** Siempre positivo. */
  desvio: number
}

export type FalloMarca = {
  idUc: number
  equipo: string
  jornada: number
  fecha: string
  saldoCalculado: number
  misterDiceNegativo: boolean
}

export type ResultadoMarcas = {
  aciertos: number
  fallos: number
  detalle: FalloMarca[]
}

function comparar(concepto: string, calculado: number, real: number): Discrepancia | null {
  if (calculado === real) return null
  return { concepto, calculado, real, desvio: Math.abs(calculado - real) }
}

/** El saldo reconstruido desde cero contra el que publica Mister. */
export function verificarSaldoPropio(estado: EstadoEquipo, datos: DatosUsuario): Discrepancia | null {
  return comparar('saldo propio', estado.saldo, datos.saldo)
}

/** El tope de puja calculado contra el `maxDebt` que publica Mister. */
export function verificarTopePropio(estado: EstadoEquipo, datos: DatosUsuario): Discrepancia | null {
  return comparar('tope de puja propio', estado.topePuja, datos.topePuja)
}

/**
 * Contrasta el signo del saldo calculado contra las marcas de saldo negativo
 * que Mister publica en cada cierre de jornada.
 *
 * Es la única comprobación que alcanza a los rivales: son ocho contrastes por
 * jornada, y ninguno usa nada que el motor haya calculado.
 */
export function verificarMarcasNegativas(
  eventos: Evento[],
  calcular: (hasta: string) => Map<number, EstadoEquipo>,
): ResultadoMarcas {
  const resultado: ResultadoMarcas = { aciertos: 0, fallos: 0, detalle: [] }

  for (const evento of eventos) {
    if (evento.tipo !== 'cierreJornada') continue
    const estados = calcular(evento.fecha)

    for (const r of evento.resultados) {
      const estado = estados.get(r.idUc)
      if (!estado) continue

      const predicho = estado.saldo < 0
      if (predicho === r.sinPuntuar) {
        resultado.aciertos++
      } else {
        resultado.fallos++
        resultado.detalle.push({
          idUc: r.idUc, equipo: r.equipo, jornada: evento.jornada, fecha: evento.fecha,
          saldoCalculado: estado.saldo, misterDiceNegativo: r.sinPuntuar,
        })
      }
    }
  }

  return resultado
}
