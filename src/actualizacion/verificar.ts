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
import type { PuestoClasificacion } from '../recoleccion/parseadorClasificacion.js'
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

/**
 * La otra mitad del seguro: contrastar los ocho equipos, no solo el propio.
 *
 * `_FG_user` solo habla de uno mismo, así que hasta ahora los siete rivales no
 * se comprobaban contra nada. Pero la clasificación publica, por equipo,
 * **cuántos jugadores tiene y cuánto vale su plantilla**, además de sus
 * puntos, y esas tres cifras el módulo las calcula por su cuenta.
 *
 * No es teórico: así se descubrió que a Los tocahuevos les faltaba Matteo
 * Ruggeri —13 jugadores y 32.359.000 € frente a los 14 y 33.658.000 € de
 * Mister—, porque el feed había publicado su salida de LaLiga y el módulo lo
 * borraba de la plantilla mientras Mister lo seguía contando.
 *
 * El valor de plantilla admite el mismo margen de redondeo que el saldo. El
 * número de jugadores y los puntos son enteros: ahí no hay margen que valga.
 */
export function verificarLiga(equipos: Equipo[], clasificacion: PuestoClasificacion[]): string[] {
  const motivos: string[] = []
  const porNombre = new Map(equipos.map((e) => [e.n, e]))

  for (const c of clasificacion) {
    const e = porNombre.get(c.equipo)
    if (e === undefined) {
      motivos.push(`Mister clasifica a «${c.equipo}» y yo no sé quién es`)
      continue
    }
    if (e.pts !== c.puntos) {
      motivos.push(`${c.equipo}: calculo ${c.puntos === e.pts ? '' : ''}${e.pts} puntos y Mister dice ${c.puntos}`)
    }
    const jugadores = e.plantilla
    if (jugadores !== c.jugadores) {
      motivos.push(`${c.equipo}: le cuento ${jugadores} jugadores y Mister dice ${c.jugadores}`)
    }
    const dif = e.pl - c.valorPlantilla
    if (Math.abs(dif) > MARGEN_REDONDEO) {
      motivos.push(
        `${c.equipo}: su plantilla me sale ${euros(e.pl)} y Mister dice ${euros(c.valorPlantilla)} (${euros(Math.abs(dif))} de diferencia)`,
      )
    }
  }

  const sinClasificar = equipos.filter((e) => !clasificacion.some((c) => c.equipo === e.n))
  for (const e of sinClasificar) motivos.push(`${e.n} no aparece en la clasificación de Mister`)

  return motivos
}
