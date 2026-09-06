import { describe, expect, it } from 'vitest'
import { verificar, verificarLiga } from '../../src/actualizacion/verificar.js'

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

// ── verificar (el equipo propio) ─────────────────────────────────────────────

const mio = (saldo: number, pl: number) => ({
  n: 'Niutin FC (Isaac)', pos: 0, pts: 0, saldo, pl, rep: 0, ini: 0, com: 0, ven: 0, pre: 0,
  plantilla: 16, sinValorar: [],
})
const suyo = (saldo: number, saldoFuturo: number, topePuja: number) => ({
  idUsuario: 1, idUc: 12493763, idComunidad: 1, equipo: 'Niutin FC (Isaac)',
  saldo, saldoFuturo, topePuja, creditos: 0, formacion: '1-3-6-1', tope: 24,
})

describe('verificar', () => {
  it('cuadra cuando no hay nada comprometido', () => {
    // 10.000.000 + 25 % de 40.000.000 = 20.000.000
    const r = verificar(mio(10_000_000, 40_000_000), suyo(10_000_000, 10_000_000, 20_000_000), 10_000_000)
    expect(r.motivos).toEqual([])
    expect(r.comprometido).toBe(0)
  })

  it('una puja viva no puede tumbar la pasada', () => {
    // El fallo real del 6 de septiembre de 2026, con sus cifras. Mister publica
    // tres saldos: `current` (21.071.960) es lo que hay, `future` (17.284.940)
    // lo que quedará cuando se resuelva una puja de 3.787.020 €, y `maxDebt` se
    // construye sobre `future`. Comparando contra `current` la diferencia era
    // exactamente un cuarto de lo comprometido, y todas las actualizaciones se
    // rechazaron durante horas mientras la puja siguió puesta.
    const r = verificar(
      mio(21_071_960, 67_822_000),
      suyo(21_071_960, 17_284_940, 34_240_440),
      21_071_960,
    )
    expect(r.motivos).toEqual([])
    expect(r.comprometido).toBe(3_787_020)
    expect(r.topeCalculado).toBe(34_240_440)
  })

  it('pero un error de verdad en la plantilla se sigue viendo', () => {
    // Mismo escenario, con un jugador de 8.720.000 € que no debería contar.
    const r = verificar(
      mio(21_071_960, 67_822_000 + 8_720_000),
      suyo(21_071_960, 17_284_940, 34_240_440),
      21_071_960,
    )
    expect(r.motivos[0]).toMatch(/el tope de puja calculado/)
  })

  it('canta si el libro de caja y la página no dicen lo mismo', () => {
    const r = verificar(mio(10_000_000, 40_000_000), suyo(10_000_000, 10_000_000, 20_000_000), 9_999_999)
    expect(r.motivos[0]).toMatch(/algo he leído mal/)
  })
})
