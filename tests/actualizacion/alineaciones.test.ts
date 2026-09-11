import { describe, expect, it } from 'vitest'
import { aQuePedir, EN_JUEGO, recolectarAlineaciones, TERMINADA } from '../../src/actualizacion/alineaciones.js'
import type { Cliente } from '../../src/recoleccion/cliente.js'
import type { AlineacionJornada, JornadaConocida } from '../../src/recoleccion/parseadorJornada.js'

const g = (jornada: number, estado: string): JornadaConocida => ({ jornada, id: 3967 + jornada, estado, desde: null, hasta: null })
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

describe('recolectarAlineaciones', () => {
  // Mister, el 11 de septiembre de 2026: la J5 sin empezar y la J6 «en juego»
  // desde el 3, porque Real Sociedad–Celta se adelantó doce días.
  const lista = {
    data: {
      gameweeks: [
        { id: 3968, gameweek: 1, status: TERMINADA, firstMatchDate: '2026-08-15 19:30:00', lastMatchDate: '2026-08-27 21:00:00' },
        { id: 4046, gameweek: 5, status: 'unstarted', firstMatchDate: '2026-09-11 21:00:00', lastMatchDate: '2026-09-14 21:00:00' },
        { id: 4047, gameweek: 6, status: EN_JUEGO, firstMatchDate: '2026-09-03 21:00:00', lastMatchDate: '2026-09-17 21:30:00' },
      ],
    },
  }
  const jornada6 = {
    data: {
      gameweekStatus: { id: 4047, gameweek: 6, status: EN_JUEGO, firstMatchDate: '2026-09-03 21:00:00', lastMatchDate: '2026-09-17 21:30:00' },
      games: [{ id: 37996, status: 'played', date: { ts: 1788462000 }, id_home: 5, id_away: 7 }, { id: 37994, status: 'fixture' }],
      gameweek_user: { points: 0, rank: 6 },
      lineup: { positions: { 1: { 1: { id: 53111, name: 'Álvaro Valles', position: 1, points: null, played: 0 } } } },
      bench: [],
    },
  }
  const cliente = {
    pedirJornada: async (id?: number | string | null) => JSON.stringify(id == null ? lista : jornada6),
  } as unknown as Cliente
  // Una alineación guardada con el formato antiguo, sin estado ni fechas.
  const vieja = { jornada: 1, idJornada: 3968, puntos: 38, puesto: 3, formacion: '1-4-5-1', once: [], banquillo: [] } as unknown as AlineacionJornada

  it('sella cada alineación con el estado y las fechas que Mister da hoy, también las de antes', async () => {
    const todas = await recolectarAlineaciones(cliente, [vieja], () => {}, { '1': {} })
    expect(todas.map((a) => [a.jornada, a.estado, a.desde, a.hasta])).toEqual([
      [1, TERMINADA, '2026-08-15 19:30:00', '2026-08-27 21:00:00'],
      [6, EN_JUEGO, '2026-09-03 21:00:00', '2026-09-17 21:30:00'],
    ])
    // Y lo que la vieja no tenía se deja explícitamente en blanco, no roto.
    expect(todas[0]).toMatchObject({ partidos: null, jugados: [] })
    expect(todas[1]).toMatchObject({ partidos: 2, jugados: [{ cuando: '2026-09-03T19:00:00.000Z', local: 5, visitante: 7 }] })
  })

  it('entrega aparte la lista de jornadas que Mister conoce, con estado y fechas', async () => {
    // De ahí sale cuál es la que va a empezar: la J5, aunque la J6 ya esté en juego.
    let conocidas: JornadaConocida[] = []
    await recolectarAlineaciones(cliente, [], () => {}, {}, (c) => { conocidas = c })
    expect(conocidas.map((g) => [g.jornada, g.estado, g.desde])).toEqual([
      [1, TERMINADA, '2026-08-15 19:30:00'],
      [5, 'unstarted', '2026-09-11 21:00:00'],
      [6, EN_JUEGO, '2026-09-03 21:00:00'],
    ])
  })

  it('no trae la que no ha empezado, aunque Mister la conteste', async () => {
    const todas = await recolectarAlineaciones(cliente, [vieja], () => {}, { '1': {} })
    expect(todas.map((a) => a.jornada)).not.toContain(5)
  })
})
