import { describe, expect, it } from 'vitest'
import {
  contrastarValorPlantilla,
  ultimoValorPlantillaConocido,
} from '../../src/contabilidad/contrasteValorPlantilla.js'
import type { CierreJornada, Evento } from '../../src/dominio/eventos.js'

const cierre = (idJornada: number, fecha: string, resultados: [number, number][]): CierreJornada => ({
  tipo: 'cierreJornada',
  idEvento: idJornada,
  idJornada,
  jornada: 1,
  fecha,
  resultados: resultados.map(([idUc, valorPlantilla]) => ({
    idUc, equipo: `Equipo ${idUc}`, premio: 0, puntos: 0, sinPuntuar: false, valorPlantilla,
  })),
})

describe('ultimoValorPlantillaConocido', () => {
  it('devuelve el valorPlantilla del único cierre de cada equipo', () => {
    const eventos: Evento[] = [cierre(1, '2026-08-20 12:00:00', [[5, 900]])]
    expect(ultimoValorPlantillaConocido(eventos)).toEqual(new Map([[5, 900]]))
  })

  it('se queda con el cierre MÁS RECIENTE de cada equipo, no el primero de la lista', () => {
    const eventos: Evento[] = [
      cierre(1, '2026-08-20 12:00:00', [[5, 900]]),
      cierre(2, '2026-08-25 12:00:00', [[5, 950]]),
    ]
    expect(ultimoValorPlantillaConocido(eventos)).toEqual(new Map([[5, 950]]))
  })

  it('no le afecta el orden de llegada de los eventos', () => {
    const eventos: Evento[] = [
      cierre(2, '2026-08-25 12:00:00', [[5, 950]]),
      cierre(1, '2026-08-20 12:00:00', [[5, 900]]),
    ]
    expect(ultimoValorPlantillaConocido(eventos)).toEqual(new Map([[5, 950]]))
  })

  it('ignora eventos que no son cierre de jornada', () => {
    const ruido: Evento = { tipo: 'ruido', idEvento: 1, fecha: '2026-08-01 10:00:00', motivo: 'x' }
    expect(ultimoValorPlantillaConocido([ruido])).toEqual(new Map())
  })

  it('recoge un equipo por cada idUc, aunque compartan cierre', () => {
    const eventos: Evento[] = [cierre(1, '2026-08-20 12:00:00', [[5, 900], [6, 700]])]
    expect(ultimoValorPlantillaConocido(eventos)).toEqual(new Map([[5, 900], [6, 700]]))
  })

  it('devuelve un mapa vacío si no hay ningún cierre', () => {
    expect(ultimoValorPlantillaConocido([])).toEqual(new Map())
  })
})

describe('contrastarValorPlantilla', () => {
  it('devuelve la diferencia entre el valor calculado y el del último cierre', () => {
    const r = contrastarValorPlantilla(new Map([[5, 1_000_000]]), new Map([[5, 900_000]]))
    expect(r).toEqual([{ idUc: 5, calculado: 1_000_000, ultimoCierre: 900_000, diferencia: 100_000 }])
  })

  it('la diferencia es negativa si el calculado es menor', () => {
    const r = contrastarValorPlantilla(new Map([[5, 800_000]]), new Map([[5, 900_000]]))
    expect(r[0]!.diferencia).toBe(-100_000)
  })

  it('la diferencia es cero si coinciden', () => {
    const r = contrastarValorPlantilla(new Map([[5, 900_000]]), new Map([[5, 900_000]]))
    expect(r[0]!.diferencia).toBe(0)
  })

  it('omite los equipos sin ningún cierre conocido, sin lanzar', () => {
    // Una liga recién reiniciada, sin jornadas cerradas todavía, no tiene
    // con qué contrastar: eso no es una anomalía, es falta de dato.
    const r = contrastarValorPlantilla(new Map([[5, 900_000]]), new Map())
    expect(r).toEqual([])
  })

  it('contrasta varios equipos a la vez', () => {
    const r = contrastarValorPlantilla(
      new Map([[5, 1_000_000], [6, 500_000]]),
      new Map([[5, 900_000], [6, 500_000]]),
    )
    expect(r).toHaveLength(2)
    expect(r.find((d) => d.idUc === 5)!.diferencia).toBe(100_000)
    expect(r.find((d) => d.idUc === 6)!.diferencia).toBe(0)
  })
})
