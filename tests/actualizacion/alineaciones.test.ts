import { describe, expect, it } from 'vitest'
import { aQuePedir, EN_JUEGO, TERMINADA } from '../../src/actualizacion/alineaciones.js'
import type { AlineacionJornada, JornadaConocida } from '../../src/recoleccion/parseadorJornada.js'

const g = (jornada: number, estado: string): JornadaConocida => ({ jornada, id: 3967 + jornada, estado })
const guardada = (jornada: number) => [jornada, { jornada } as AlineacionJornada] as const

describe('aQuePedir', () => {
  it('no pide las que no han empezado', () => {
    // Mister las contesta igual, rellenas con la plantilla de hoy, como si las
    // hubieras alineado tú. Sin este filtro se guardaban treinta y tres
    // alineaciones inventadas.
    expect(aQuePedir([g(7, 'unstarted'), g(8, 'unstarted')], new Map())).toEqual([])
  })

  it('pide una vez las terminadas y no vuelve a por ellas', () => {
    expect(aQuePedir([g(1, TERMINADA)], new Map()).map((x) => x.jornada)).toEqual([1])
    expect(aQuePedir([g(1, TERMINADA)], new Map([guardada(1)]), new Set([1]))).toEqual([])
  })

  it('vuelve siempre a por la que se está jugando, porque sus puntos suben', () => {
    expect(aQuePedir([g(4, EN_JUEGO)], new Map([guardada(4)])).map((x) => x.jornada)).toEqual([4])
  })

  it('vuelve a por una terminada si tiene alineación pero no eventos', () => {
    // Las jornadas guardadas antes de que se leyeran los minutos se daban por
    // hechas, así que su detalle no llegaba nunca.
    const conocidas = [g(1, TERMINADA)]
    expect(aQuePedir(conocidas, new Map([guardada(1)]), new Set()).map((x) => x.jornada)).toEqual([1])
    expect(aQuePedir(conocidas, new Map([guardada(1)]), new Set([1]))).toEqual([])
  })

  it('mezcla los tres casos sin confundirse', () => {
    const conocidas = [g(1, TERMINADA), g(2, TERMINADA), g(4, EN_JUEGO), g(5, 'unstarted')]
    expect(aQuePedir(conocidas, new Map([guardada(1)]), new Set([1])).map((x) => x.jornada)).toEqual([2, 4])
  })
})
