import type { Evento } from '../dominio/eventos.js'

/**
 * Diferencia, para un equipo, entre el valor de plantilla que calcula el
 * motor (`calcularValorPlantillaActual`, en `motor.ts`) y el que Mister
 * publicó en el último cierre de jornada conocido de ese equipo
 * (`ResultadoEquipo.valorPlantilla`).
 *
 * Es una comprobación de cordura que el feed da gratis y que hasta ahora no
 * se usaba: si `parsearPlantilla` colara un enlace ajeno a la plantilla real
 * de un equipo (Importante 7), el valor calculado se dispararía frente al
 * que Mister ya tenía bien, y esta diferencia lo delataría de inmediato.
 */
export type DivergenciaValorPlantilla = {
  idUc: number
  calculado: number
  ultimoCierre: number
  diferencia: number
}

/**
 * El `valorPlantilla` del cierre de jornada MÁS RECIENTE conocido de cada
 * equipo, uno por `idUc`.
 *
 * Un equipo aparece en tantos cierres como jornadas jugadas; solo el último
 * sirve como término de contraste, porque el valor de plantilla cambia con
 * cada fichaje y con las variaciones diarias de mercado. El orden de
 * `eventos` es irrelevante: se compara por `fecha`, no por posición en la
 * lista.
 */
export function ultimoValorPlantillaConocido(eventos: Evento[]): Map<number, number> {
  const masReciente = new Map<number, { fecha: string; valor: number }>()

  for (const evento of eventos) {
    if (evento.tipo !== 'cierreJornada') continue
    for (const r of evento.resultados) {
      const actual = masReciente.get(r.idUc)
      if (!actual || evento.fecha > actual.fecha) {
        masReciente.set(r.idUc, { fecha: evento.fecha, valor: r.valorPlantilla })
      }
    }
  }

  return new Map([...masReciente].map(([idUc, { valor }]) => [idUc, valor]))
}

/**
 * Contrasta, equipo a equipo, el valor de plantilla calculado contra el
 * último conocido por Mister (ver `ultimoValorPlantillaConocido`).
 *
 * Devuelve solo los equipos presentes en ambos mapas: uno sin ningún cierre
 * todavía (p. ej. una liga recién reiniciada, antes de la primera jornada)
 * no tiene con qué contrastar, y eso no es una anomalía en sí misma — no se
 * lanza por ello.
 *
 * No decide qué es "divergir mucho": fijar ese umbral y avisar es cosa de
 * quien la use (la orden de análisis), no de esta función.
 */
export function contrastarValorPlantilla(
  valorCalculado: Map<number, number>,
  ultimoCierre: Map<number, number>,
): DivergenciaValorPlantilla[] {
  const divergencias: DivergenciaValorPlantilla[] = []

  for (const [idUc, calculado] of valorCalculado) {
    const conocido = ultimoCierre.get(idUc)
    if (conocido === undefined) continue
    divergencias.push({ idUc, calculado, ultimoCierre: conocido, diferencia: calculado - conocido })
  }

  return divergencias
}
