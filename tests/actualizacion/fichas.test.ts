import { describe, expect, it } from 'vitest'
import { aQuienPedir, DIAS_ANTES_DE_REFRESCAR, type FichaGuardada } from '../../src/actualizacion/fichas.js'

const HOY = '2026-09-07'
const ficha = (partidos: number | undefined, dia = HOY) =>
  ({ nombre: 'x', posicion: 3, goles: 0, tarjetas: 0, mediaCasa: null, mediaFuera: null, edad: 20, titular: null, titularidades: 0, suplencias: 0, dia, partidos }) as unknown as FichaGuardada
const j = (id: string, partidos: number) => ({ id, partidos })

describe('aQuienPedir', () => {
  it('a quien no ha jugado desde la última vez, no se le pide nada', () => {
    // Es el arreglo entero: sus goles, tarjetas y medias no pueden haber
    // cambiado, así que pedir su ficha es gastar un segundo en reescribir lo
    // mismo. Multiplicado por 523, cincuenta minutos.
    expect(aQuienPedir([j('1', 4), j('2', 4)], { 1: ficha(4), 2: ficha(4) }, HOY)).toEqual([])
  })

  it('a quien ha jugado, sí', () => {
    expect(aQuienPedir([j('1', 5), j('2', 4)], { 1: ficha(4), 2: ficha(4) }, HOY)).toEqual(['1'])
  })

  it('a quien no tenemos, también', () => {
    expect(aQuienPedir([j('9', 0)], {}, HOY)).toEqual(['9'])
  })

  it('y a quien lleva una semana, para que el pronóstico no envejezca', () => {
    const viejo = ficha(4, '2026-08-25')
    expect(aQuienPedir([j('1', 4)], { 1: viejo }, HOY)).toEqual(['1'])
    const reciente = ficha(4, '2026-09-05')
    expect(aQuienPedir([j('1', 4)], { 1: reciente }, HOY)).toEqual([])
    expect(DIAS_ANTES_DE_REFRESCAR).toBeGreaterThan(1)
  })

  it('los míos van delante aunque no hayan jugado', () => {
    // De ellos sale el once, y el pronóstico de titularidad solo está aquí.
    const fichas = { 1: ficha(4, '2026-08-01'), 2: ficha(4, '2026-08-01') }
    expect(aQuienPedir([j('1', 4), j('2', 4)], fichas, HOY, new Set(['2']))).toEqual(['2', '1'])
  })

  it('nunca pide más del tope, y deja el resto para la siguiente pasada', () => {
    const universo = Array.from({ length: 300 }, (_, i) => j(String(i), 1))
    expect(aQuienPedir(universo, {}, HOY, new Set(), 120)).toHaveLength(120)
  })

  it('una ficha guardada antes de que se supieran los partidos se refresca una vez', () => {
    expect(aQuienPedir([j('1', 4)], { 1: ficha(undefined) }, HOY)).toEqual(['1'])
  })
})
