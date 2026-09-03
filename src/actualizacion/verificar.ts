/**
 * El seguro de la actualización: contrastar lo calculado con lo que dice Mister.
 *
 * Cada página de Mister lleva incrustado `var _FG_user` con el saldo y el tope
 * de puja reales del usuario. Son dos cifras que el motor calcula por su
 * cuenta desde el histórico, así que compararlas es una comprobación de
 * verdad: si el cálculo se tuerce —un traspaso mal leído, un premio contado
 * dos veces—, dejan de coincidir.
 *
 * Cuando no coinciden, la actualización no escribe nada. Es preferible seguir
 * viendo las cifras de ayer, sabiendo que son de ayer, que unas de hoy que
 * están mal sin que nadie lo diga.
 */
import type { DatosUsuario } from '../recoleccion/parseadorFgUser.js'
import type { Equipo } from './reconstruir.js'

/**
 * Mister publica los valores de los jugadores redondeados a millares, y el
 * valor de plantilla del reparto inicial se reconstruyó sumando esos valores
 * redondeados. El desfase acumulado medido es de 800 €; este margen lo cubre
 * con holgura sin tapar un error de verdad, que sería de otro orden.
 */
export const MARGEN_REDONDEO = 5000

export type Veredicto = {
  cuadra: boolean
  saldoCalculado: number
  saldoDeMister: number
  topeCalculado: number
  topeDeMister: number
  motivos: string[]
}

export function verificar(mio: Equipo, mister: DatosUsuario): Veredicto {
  const topeCalculado = mio.saldo + 0.25 * mio.pl
  const motivos: string[] = []

  const dSaldo = mio.saldo - mister.saldo
  if (Math.abs(dSaldo) > MARGEN_REDONDEO) {
    motivos.push(
      `el saldo calculado (${euros(mio.saldo)}) se aparta ${euros(Math.abs(dSaldo))} del que publica Mister (${euros(mister.saldo)})`,
    )
  }

  const dTope = topeCalculado - mister.topePuja
  if (Math.abs(dTope) > MARGEN_REDONDEO) {
    motivos.push(
      `el tope de puja calculado (${euros(topeCalculado)}) se aparta ${euros(Math.abs(dTope))} del que publica Mister (${euros(mister.topePuja)})`,
    )
  }

  // Si falta el valor de algún jugador de la plantilla propia, el tope sale
  // corto y la comparación de arriba ya lo delata. Se dice aparte porque la
  // causa es distinta —un dato que falta, no una cuenta mal hecha— y también
  // el remedio.
  if (mio.sinValorar.length > 0) {
    motivos.push(
      `faltan por valorar ${mio.sinValorar.length} jugadores de tu plantilla (${mio.sinValorar.join(', ')})`,
    )
  }

  return {
    cuadra: motivos.length === 0,
    saldoCalculado: mio.saldo,
    saldoDeMister: mister.saldo,
    topeCalculado,
    topeDeMister: mister.topePuja,
    motivos,
  }
}

const euros = (n: number) => `${Math.round(n).toLocaleString('es-ES')} €`
