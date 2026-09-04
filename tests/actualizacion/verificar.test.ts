import { describe, expect, it } from 'vitest'
import { verificarLiga } from '../../src/actualizacion/verificar.js'
describe('verificarLiga', () => {
  const equipo = (n: string, pts: number, plantilla: number, pl: number) =>
    ({ n, pos: 0, pts, saldo: 0, pl, rep: 0, ini: 0, com: 0, ven: 0, pre: 0, plantilla, sinValorar: [] })
  const puesto = (equipo: string, puntos: number, jugadores: number, valorPlantilla: number) =>
    ({ puesto: 1, equipo, puntos, jugadores, valorPlantilla })

  it('calla cuando los ocho coinciden', () => {
    expect(verificarLiga([equipo('A', 10, 5, 1000)], [puesto('A', 10, 5, 1000)])).toEqual([])
  })

  it('canta un jugador de más o de menos', () => {
    // Es el fallo real que destapó esta comprobación: a Los tocahuevos les
    // faltaba Matteo Ruggeri, borrado por haber salido de LaLiga.
    expect(verificarLiga([equipo('A', 10, 13, 1000)], [puesto('A', 10, 14, 1000)])[0]).toMatch(
      /le cuento 13 jugadores y Mister dice 14/,
    )
  })

  it('canta los puntos', () => {
    expect(verificarLiga([equipo('A', 92, 5, 1000)], [puesto('A', 93, 5, 1000)])[0]).toMatch(/92 puntos y Mister dice 93/)
  })

  it('el valor de plantilla admite el redondeo a millares, pero no más', () => {
    expect(verificarLiga([equipo('A', 10, 5, 1000800)], [puesto('A', 10, 5, 1000000)])).toEqual([])
    expect(verificarLiga([equipo('A', 10, 5, 1010000)], [puesto('A', 10, 5, 1000000)])).toHaveLength(1)
  })

  it('un equipo que no está en la clasificación no pasa desapercibido', () => {
    expect(verificarLiga([equipo('A', 10, 5, 1000)], [])[0]).toMatch(/no aparece en la clasificación/)
    expect(verificarLiga([], [puesto('B', 1, 1, 1)])[0]).toMatch(/no sé quién es/)
  })
})
