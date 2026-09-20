import { describe, expect, it } from 'vitest'
import {
  anotarTopes,
  comprobarPujas,
  instanteDeMister,
  topeLibre,
  type EstadoPujas,
  type FotoTopes,
} from '../../src/actualizacion/pujas.js'
import type { Traspaso } from '../../src/actualizacion/feed.js'

const YO = 'Niutin FC (Isaac)'
const NEKY = 'Neky F.C. (Sergio)'
const MARIO = 'Mario80'

const foto = (cuando: string, topes: Record<string, number>): FotoTopes => ({ cuando, topes })

const subasta = (over: Partial<Traspaso> = {}): Traspaso => ({
  idTransfer: 1,
  idJugador: '48657',
  nombre: 'Raphinha',
  de: 'Mister',
  a: YO,
  idUcDe: 0,
  idUcA: 1,
  importe: 28_208_876,
  tipo: 'normal',
  cuando: '2026-09-20 05:00:27',
  valor: 20_572_000,
  posicion: 4,
  puntos: 108,
  media: 15.4,
  racha: '',
  otrasPujas: [
    { equipo: NEKY, puja: 28_056_362 },
    { equipo: MARIO, puja: 20_593_630 },
  ],
  ...over,
})

const vacio = (): EstadoPujas => ({ ajustes: {}, vistas: {} })

describe('instanteDeMister', () => {
  it('lee la hora de Madrid sin desfase, que es como la escribe Mister', () => {
    // 05:00 en Madrid en septiembre (verano, UTC+2) son las 03:00 UTC.
    expect(instanteDeMister('2026-09-20 05:00:27')).toBe(Date.parse('2026-09-20T03:00:27Z'))
  })
  it('una fecha rota no es un instante', () => {
    expect(instanteDeMister('ayer')).toBeNull()
  })
})

describe('anotarTopes', () => {
  const equipos = [
    { n: YO, saldo: 4_176_376, pl: 96_130_000 },
    { n: NEKY, saldo: -2_800_375, pl: 118_837_000 },
  ]

  it('apunta el tope de cada equipo como si no tuviera ninguna puja pendiente', () => {
    // saldo + 25 % de plantilla, sin restar lo comprometido: lo comprometido
    // ES la puja, y compararla contra un tope que ya la descuenta sería
    // compararla contra cero.
    const h = anotarTopes([], '2026-09-20T02:58:38Z', equipos)
    expect(h).toEqual([foto('2026-09-20T02:58:38Z', { [YO]: 28_208_876, [NEKY]: 26_908_875 })])
    expect(topeLibre({ saldo: 100, pl: 400 })).toBe(200)
  })

  it('no modifica el histórico que recibe y tira lo de hace más de 72 h', () => {
    const previo = [foto('2026-09-16T00:00:00Z', { [YO]: 1 }), foto('2026-09-19T00:00:00Z', { [YO]: 2 })]
    const copia = JSON.parse(JSON.stringify(previo))
    const h = anotarTopes(previo, '2026-09-20T00:00:00Z', equipos)
    expect(previo).toEqual(copia)
    expect(h.map((f) => f.cuando)).toEqual(['2026-09-19T00:00:00Z', '2026-09-20T00:00:00Z'])
  })
})

describe('comprobarPujas', () => {
  // El día 19, el tope de Neky fue 28,28 M por la mañana y bajó a 26,9 M de
  // madrugada por una compra; el de Mario80 se quedó en 20,93 M.
  const historicoReal: FotoTopes[] = [
    foto('2026-09-18T20:00:00Z', { [YO]: 15_000_000, [NEKY]: 28_800_000, [MARIO]: 20_500_000 }),
    foto('2026-09-19T04:11:00Z', { [YO]: 15_821_816, [NEKY]: 28_277_375, [MARIO]: 20_928_660 }),
    foto('2026-09-19T15:11:00Z', { [YO]: 15_821_816, [NEKY]: 23_031_375, [MARIO]: 20_928_660 }),
    foto('2026-09-20T02:58:38Z', { [YO]: 28_208_876, [NEKY]: 26_908_875, [MARIO]: 20_928_660 }),
  ]

  it('compara cada puja contra el MÁXIMO del tope mientras el jugador estuvo en el mercado', () => {
    // Neky pujó 28,06 M. Justo antes de resolverse tenía 26,9 M, pero la puja
    // se fija cuando se hace, y esa mañana tenía 28,28 M: no hay exceso.
    const r = comprobarPujas([subasta()], historicoReal, vacio(), YO)
    const neky = r.resultados.find((x) => x.equipo === NEKY)!
    expect(neky.topeMax).toBe(28_277_375)
    expect(neky.exceso).toBe(0)
    expect(r.estado.ajustes).toEqual({})
  })

  it('la puja ganadora también cuenta: el comprador tuvo que poder pagarla', () => {
    const r = comprobarPujas([subasta()], historicoReal, vacio(), YO)
    const yo = r.resultados.find((x) => x.equipo === YO)!
    expect(yo.gana).toBe(true)
    expect(yo.puja).toBe(28_208_876)
    expect(yo.exceso).toBe(0)
  })

  it('si un rival pujó más de lo que le calculábamos, la diferencia es dinero que tenía: se le suma', () => {
    const corto = historicoReal.map((f) => ({ ...f, topes: { ...f.topes, [MARIO]: 19_500_000 } }))
    const r = comprobarPujas([subasta()], corto, vacio(), YO)
    const mario = r.resultados.find((x) => x.equipo === MARIO)!
    expect(mario.exceso).toBe(20_593_630 - 19_500_000)
    expect(r.estado.ajustes[MARIO]).toBe(1_093_630)
    expect(r.avisos.some((a) => a.includes('Mario80') && a.includes('1.093.630'))).toBe(true)
  })

  it('una diferencia dentro del margen de redondeo de Mister no es un exceso', () => {
    const casi = historicoReal.map((f) => ({ ...f, topes: { ...f.topes, [MARIO]: 20_593_630 - 3_000 } }))
    const r = comprobarPujas([subasta()], casi, vacio(), YO)
    expect(r.estado.ajustes).toEqual({})
  })

  it('una subasta ya vista no se vuelve a aplicar en la pasada siguiente', () => {
    const corto = historicoReal.map((f) => ({ ...f, topes: { ...f.topes, [MARIO]: 19_500_000 } }))
    const primera = comprobarPujas([subasta()], corto, vacio(), YO)
    const segunda = comprobarPujas([subasta()], corto, primera.estado, YO)
    expect(segunda.resultados).toEqual([])
    expect(segunda.estado.ajustes[MARIO]).toBe(1_093_630)
  })

  it('el ajuste ya sumado cuenta en la siguiente subasta: la misma diferencia no se suma dos veces', () => {
    // Mario80 puja 20,59 M en dos subastas del mismo ciclo. Le calculábamos
    // 19,5 M: falta 1,09 M, una vez. La segunda puja se compara ya con el tope
    // corregido y no añade nada.
    const corto = historicoReal.map((f) => ({ ...f, topes: { ...f.topes, [MARIO]: 19_500_000 } }))
    const otra = subasta({ idTransfer: 2, nombre: 'Otro', a: NEKY, importe: 5_000_000, otrasPujas: [{ equipo: MARIO, puja: 20_593_630 }] })
    const r = comprobarPujas([subasta(), otra], corto, vacio(), YO)
    expect(r.estado.ajustes[MARIO]).toBe(1_093_630)
  })

  it('sin fotos de antes de que el jugador saliera al mercado, no se puede saber nada y no se toca', () => {
    // Solo hay una foto de dos horas antes: si la puja se hizo antes de eso,
    // con un tope mayor, un "exceso" sería un espejismo. Se deja constancia.
    const sinCobertura = [foto('2026-09-20T01:00:00Z', { [YO]: 1, [NEKY]: 1, [MARIO]: 1 })]
    const r = comprobarPujas([subasta()], sinCobertura, vacio(), YO)
    expect(r.resultados.every((x) => x.topeMax === null && x.exceso === 0)).toBe(true)
    expect(r.estado.ajustes).toEqual({})
    expect(r.estado.vistas['1']).toBeDefined()
  })

  it('al propio equipo no se le ajusta nada: su caja es exacta, un exceso ahí sería un fallo a mirar', () => {
    const corto = historicoReal.map((f) => ({ ...f, topes: { ...f.topes, [YO]: 20_000_000 } }))
    const r = comprobarPujas([subasta()], corto, vacio(), YO)
    const yo = r.resultados.find((x) => x.equipo === YO)!
    expect(yo.exceso).toBe(8_208_876)
    expect(r.estado.ajustes[YO]).toBeUndefined()
    expect(r.avisos.some((a) => a.includes('propio'))).toBe(true)
  })

  it('un traspaso sin pujas y sin comprador de la liga no aporta nada', () => {
    const salida = subasta({ idTransfer: 3, a: null, de: YO, otrasPujas: [] })
    const r = comprobarPujas([salida], historicoReal, vacio(), YO)
    expect(r.resultados).toEqual([])
  })
})
