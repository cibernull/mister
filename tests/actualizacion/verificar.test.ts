import { describe, expect, it } from 'vitest'
import { verificarLiga } from '../../src/actualizacion/verificar.js'

const equipo = (n: string, pts: number, plantilla: number, pl: number) => ({
  n, pos: 0, pts, saldo: 0, pl, rep: 0, ini: 0, com: 0, ven: 0, pre: 0, plantilla, sinValorar: [],
})
const puesto = (equipo: string, puntos: number, jugadores: number, valorPlantilla: number) => ({
  puesto: 1, equipo, puntos, jugadores, valorPlantilla,
})

describe('verificarLiga', () => {
  it('calla cuando los ocho coinciden', () => {
    expect(verificarLiga([equipo('A', 10, 5, 1000)], [puesto('A', 10, 5, 1000)])).toEqual({ motivos: [], avisos: [] })
  })

  it('canta un jugador de más o de menos', () => {
    // Es el fallo real que destapó esta comprobación: a Los tocahuevos les
    // faltaba Matteo Ruggeri, borrado por haber salido de LaLiga.
    expect(verificarLiga([equipo('A', 10, 13, 1000)], [puesto('A', 10, 14, 1000)]).motivos[0]).toMatch(
      /le cuento 13 jugadores y Mister dice 14/,
    )
  })

  it('el valor de plantilla admite el redondeo a millares, pero no más', () => {
    expect(verificarLiga([equipo('A', 10, 5, 1000800)], [puesto('A', 10, 5, 1000000)]).motivos).toEqual([])
    expect(verificarLiga([equipo('A', 10, 5, 1010000)], [puesto('A', 10, 5, 1000000)]).motivos).toHaveLength(1)
  })

  it('los puntos revisados se avisan, pero no tumban la pasada', () => {
    // Mister los recalcula cuando llegan las estadísticas oficiales: en una
    // tarde bajó a Betico de 17 a 9 y subió a Niutin de 119 a 134. Bloquear por
    // eso dejaba la app congelada cada vez, y encima manda la cifra suya.
    const r = verificarLiga([equipo('Betico1993', 17, 13, 1000)], [puesto('Betico1993', 9, 13, 1000)])
    expect(r.motivos).toEqual([])
    expect(r.avisos[0]).toMatch(/ha revisado sus puntos de 17 a 9/)
  })

  it('un equipo que no está en la clasificación no pasa desapercibido', () => {
    expect(verificarLiga([equipo('A', 10, 5, 1000)], []).motivos[0]).toMatch(/no aparece en la clasificación/)
    expect(verificarLiga([], [puesto('B', 1, 1, 1)]).motivos[0]).toMatch(/no sé quién es/)
  })
})
