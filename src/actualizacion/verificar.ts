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
 * Mister publica los valores de los jugadores redondeados a millares, así que
 * la suma de una plantilla puede quedar unos cientos de euros por debajo del
 * `maxDebt` que él mismo calcula. Este margen lo cubre con holgura sin tapar un
 * error de verdad, que sería de otro orden.
 */
export const MARGEN_REDONDEO = 5000

export type Veredicto = {
  cuadra: boolean
  saldoCalculado: number
  saldoDeMister: number
  topeCalculado: number
  topeDeMister: number
  /** Dinero retenido por pujas vivas: está en el saldo pero ya no es tuyo. */
  comprometido: number
  motivos: string[]
}

export function verificar(mio: Equipo, mister: DatosUsuario, saldoDelLibro: number): Veredicto {
  // Mister publica tres cifras de dinero, no dos: `current` es lo que tienes,
  // `future` es lo que te quedará cuando se resuelvan las pujas que has dejado
  // puestas, y `maxDebt` se construye sobre `future`. Usar `current` aquí
  // funcionó durante semanas porque no había ninguna puja viva a la hora de
  // actualizar; en cuanto la hubo, esta comprobación empezó a rechazar cada
  // pasada por la diferencia exacta de lo comprometido.
  //
  // Lo comprometido se toma de Mister porque el libro de caja no lo publica —
  // una puja no es un apunte hasta que se resuelve—, pero el saldo base sigue
  // siendo el calculado, para no perder la comparación independiente.
  const comprometido = mister.saldo - mister.saldoFuturo
  const topeCalculado = mio.saldo - comprometido + 0.25 * mio.pl
  const motivos: string[] = []

  // El saldo ya no se calcula: se lee del libro de caja. Compararlo con el que
  // trae la página es una comprobación de que se ha leído bien, y ahí no hay
  // margen que valga: son dos cifras de Mister sobre lo mismo.
  if (saldoDelLibro !== mister.saldo) {
    motivos.push(
      `el libro de caja dice ${euros(saldoDelLibro)} y la página dice ${euros(mister.saldo)}; algo he leído mal`,
    )
  }

  // Lo que sí se calcula aquí es el valor de la plantilla, y el tope de puja lo
  // delata: `maxDebt` es el saldo disponible más el 25 % de la plantilla. Si
  // sobra o falta un jugador, o su valor está viejo, se ve aquí.
  const dTope = topeCalculado - mister.topePuja
  if (Math.abs(dTope) > MARGEN_REDONDEO) {
    motivos.push(
      `el tope de puja calculado (${euros(topeCalculado)}) se aparta ${euros(Math.abs(dTope))} del que publica Mister (${euros(mister.topePuja)})`,
    )
  }

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
    comprometido,
    motivos,
  }
}

/**
 * La otra mitad del seguro: contrastar los ocho equipos, no solo el propio.
 *
 * `_FG_user` solo habla de uno mismo, así que hasta ahora los siete rivales no
 * se comprobaban contra nada. Pero la clasificación publica, por equipo,
 * **cuántos jugadores tiene y cuánto vale su plantilla**, y esas dos cifras el
 * módulo las calcula por su cuenta desde el censo.
 *
 * No es teórico: así se descubrió que a Los tocahuevos les faltaba Matteo
 * Ruggeri —13 jugadores y 32.359.000 € frente a los 14 y 33.658.000 € de
 * Mister—, porque el feed había publicado su salida de LaLiga y el módulo lo
 * borraba de la plantilla mientras Mister lo seguía contando.
 *
 * Los **puntos no se comprueban**, y es a propósito: ya no se calculan, se
 * copian de aquí. Mister los revisa cuando llegan las estadísticas oficiales
 * —un día bajó a Betico de 17 a 9 y subió a Niutin de 119 a 134 a la vez— y
 * sumar los cierres de jornada del feed nunca iba a seguirle el paso. Cuando la
 * suma y la cifra oficial no coinciden se dice, pero no se bloquea nada: manda
 * la oficial.
 *
 * El valor de plantilla admite el mismo margen de redondeo que el saldo. El
 * número de jugadores es entero: ahí no hay margen que valga.
 */
export function verificarLiga(
  equipos: Equipo[],
  clasificacion: PuestoClasificacion[],
): { motivos: string[]; avisos: string[] } {
  const motivos: string[] = []
  const avisos: string[] = []
  const porNombre = new Map(equipos.map((e) => [e.n, e]))

  for (const c of clasificacion) {
    const e = porNombre.get(c.equipo)
    if (e === undefined) {
      motivos.push(`Mister clasifica a «${c.equipo}» y yo no sé quién es`)
      continue
    }
    if (e.plantilla !== c.jugadores) {
      motivos.push(`${c.equipo}: le cuento ${e.plantilla} jugadores y Mister dice ${c.jugadores}`)
    }
    const dif = e.pl - c.valorPlantilla
    if (Math.abs(dif) > MARGEN_REDONDEO) {
      motivos.push(
        `${c.equipo}: su plantilla me sale ${euros(e.pl)} y Mister dice ${euros(c.valorPlantilla)} (${euros(Math.abs(dif))} de diferencia)`,
      )
    }
    if (e.pts !== c.puntos) {
      avisos.push(
        `${c.equipo}: Mister ha revisado sus puntos de ${e.pts} a ${c.puntos}; mando la cifra suya`,
      )
    }
  }

  for (const e of equipos) {
    if (!clasificacion.some((c) => c.equipo === e.n)) motivos.push(`${e.n} no aparece en la clasificación de Mister`)
  }

  return { motivos, avisos }
}

const euros = (n: number) => `${Math.round(n).toLocaleString('es-ES')} €`
