import { describe, expect, it } from 'vitest'
import {
  DiscontinuidadError,
  comprobarContinuidad,
} from '../../src/recoleccion/integridad.js'
import type { PaginaCruda } from '../../src/almacen/crudo.js'

const p = (offset: number, nEventos: number): PaginaCruda => ({
  offset,
  nEventos,
  cuerpo: '{}',
  capturadaEn: '2026-09-03T10:00:00Z',
})

describe('comprobarContinuidad', () => {
  it('acepta lotes que encajan exactamente', () => {
    expect(() => comprobarContinuidad([p(0, 21), p(21, 21), p(42, 5), p(47, 0)])).not.toThrow()
  })

  it('acepta una sola página', () => {
    expect(() => comprobarContinuidad([p(0, 21)])).not.toThrow()
  })

  it('acepta una lista vacía', () => {
    expect(() => comprobarContinuidad([])).not.toThrow()
  })

  it('lanza si el primer offset no es cero', () => {
    expect(() => comprobarContinuidad([p(21, 21)])).toThrow(DiscontinuidadError)
  })

  it('lanza si hay un salto entre lotes', () => {
    expect(() => comprobarContinuidad([p(0, 21), p(50, 21)])).toThrow(DiscontinuidadError)
  })

  it('lanza si hay solape entre lotes', () => {
    expect(() => comprobarContinuidad([p(0, 21), p(10, 21)])).toThrow(DiscontinuidadError)
  })

  it('el error dice qué offset se esperaba y cuál se halló', () => {
    try {
      comprobarContinuidad([p(0, 21), p(50, 21)])
      expect.unreachable('debería haber lanzado')
    } catch (e) {
      expect(e).toBeInstanceOf(DiscontinuidadError)
      expect((e as DiscontinuidadError).offsetEsperado).toBe(21)
      expect((e as DiscontinuidadError).offsetHallado).toBe(50)
    }
  })
})
