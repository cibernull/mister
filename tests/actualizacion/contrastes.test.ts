import { describe, expect, it } from 'vitest'
import { contrastarClausulasPagadas, contrastarPremios } from '../../src/actualizacion/contrastes.js'
import type { Jornada, Traspaso } from '../../src/actualizacion/feed.js'

const YO = 12493763

const jornada = (n: number, cuando: string, premioMio: number, cuantos = 8): Jornada => ({
  idJornada: 3967 + n,
  jornada: n,
  cuando,
  posiciones: Array.from({ length: cuantos }, (_, i) => ({
    idUc: i === 0 ? YO : 100 + i,
    puntos: 10,
    puesto: i + 1,
    valorPlantilla: 1,
    premio: i === 0 ? premioMio : 100_000,
  })),
})

const apunte = (fecha: string, motivo: string, importe: number, tipo = 'Bonificación') => ({ cuando: 0, fecha, motivo, tipo, importe, saldo: 0 })

describe('contrastarPremios', () => {
  it('no dice nada cuando cada premio del feed coincide con el libro de caja', () => {
    const avisos = contrastarPremios(
      [jornada(5, '2026-09-15 12:23:29', 3_075_000), jornada(6, '2026-09-18 10:58:43', 925_000)],
      [apunte('2026-09-15 12:22', 'Jornada 5', 3_075_000), apunte('2026-09-18 10:57', 'Jornada 6', 925_000)],
      YO,
      [{ jornada: 5, estado: 'finished' }, { jornada: 6, estado: 'finished' }, { jornada: 7, estado: 'ongoing' }],
    )
    expect(avisos).toEqual([])
  })

  it('si el premio del feed no es el que cobró el libro, avisa: ese evento paga a los ocho', () => {
    const avisos = contrastarPremios(
      [jornada(5, '2026-09-15 12:23:29', 3_000_000)],
      [apunte('2026-09-15 12:22', 'Jornada 5', 3_075_000)],
      YO,
      [{ jornada: 5, estado: 'finished' }],
    )
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).toMatch(/J5.*3\.000\.000.*3\.075\.000/)
  })

  it('una jornada terminada según Mister sin cierre en el feed deja a los ocho sin ese dinero: avisa', () => {
    const avisos = contrastarPremios([jornada(5, '2026-09-15 12:23:29', 3_075_000)], [apunte('2026-09-15 12:22', 'Jornada 5', 3_075_000)], YO, [
      { jornada: 5, estado: 'finished' },
      { jornada: 6, estado: 'finished' },
    ])
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).toMatch(/J6/)
  })

  it('un cierre con menos de ocho equipos es un cierre a medias', () => {
    const avisos = contrastarPremios([jornada(5, '2026-09-15 12:23:29', 3_075_000, 7)], [apunte('2026-09-15 12:22', 'Jornada 5', 3_075_000)], YO, [])
    expect(avisos.some((a) => /J5.*7 equipos/.test(a))).toBe(true)
  })

  it('un cierre cobrado en el libro pero que no está en el feed también se dice', () => {
    const avisos = contrastarPremios([], [apunte('2026-09-15 12:22', 'Jornada 5', 3_075_000)], YO, [])
    expect(avisos.some((a) => /J5/.test(a) && /libro/.test(a))).toBe(true)
  })
})

const clausula = (over: Partial<Traspaso> = {}): Traspaso => ({
  idTransfer: 9,
  idJugador: '616',
  nombre: 'Rodri Hernández',
  de: 'Niutin FC (Isaac)',
  a: 'Neky F.C. (Sergio)',
  idUcDe: 1,
  idUcA: 2,
  importe: 21_198_000,
  tipo: 'clause',
  cuando: '2026-09-20 05:35:55',
  valor: 14_132_000,
  posicion: 3,
  puntos: 0,
  media: 0,
  racha: '',
  otrasPujas: [],
  ...over,
})

describe('contrastarClausulasPagadas', () => {
  // Lo que teníamos apuntado el día anterior: cláusula en base (×1,5) y valor de entonces.
  const clausulas = { '2026-09-19': { '616': 20_977_500 } }
  const valores = { '2026-09-19': { '616': 13_985_000 } }

  it('una cláusula pagada en base cuando teníamos apuntada la base no dice nada', () => {
    expect(contrastarClausulasPagadas([clausula()], clausulas, valores)).toEqual([])
  })

  it('si pagó una cláusula con más subidas de las que teníamos apuntadas, lo que estimábamos del vendedor está mal', () => {
    // Pagó ×2,0: una subida. Nosotros la teníamos en base: el vendedor pagó
    // por subirla y no se lo estábamos descontando.
    const avisos = contrastarClausulasPagadas([clausula({ importe: 28_264_000 })], clausulas, valores)
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).toMatch(/Rodri Hernández/)
    expect(avisos[0]).toMatch(/1 subida/)
    expect(avisos[0]).toMatch(/0/)
  })

  it('si la teníamos con subidas y pagó la base, estábamos descontando de más al vendedor', () => {
    const conSubida = { '2026-09-19': { '616': 27_970_000 } }
    const avisos = contrastarClausulasPagadas([clausula()], conSubida, valores)
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).toMatch(/0 subidas/)
  })

  it('sin cláusula apuntada del día anterior no se puede contrastar y no se inventa nada', () => {
    expect(contrastarClausulasPagadas([clausula()], {}, valores)).toEqual([])
  })

  it('los traspasos que no son por cláusula no se miran', () => {
    const conSubida = { '2026-09-19': { '616': 27_970_000 } }
    expect(contrastarClausulasPagadas([clausula({ tipo: 'normal' })], conSubida, valores)).toEqual([])
  })
})
