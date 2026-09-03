import { describe, expect, it } from 'vitest'
import {
  DiscontinuidadError,
  RecoleccionIncompletaError,
  comprobarCompletitud,
  comprobarContinuidad,
} from '../../src/recoleccion/integridad.js'
import type { Captura } from '../../src/almacen/crudo.js'

const p = (offset: number, nEventos: number): Captura => ({
  recoleccion: 'r1',
  offset,
  nEventos,
  cuerpo: '{}',
  capturadaEn: '2026-09-03T10:00:00Z',
})

/** Lote intermedio con datos, como los que produce `ruido(n)` en otros tests. */
const pOk = (offset: number, n: number): Captura => ({
  recoleccion: 'r1',
  offset,
  nEventos: n,
  cuerpo: JSON.stringify({ status: 'ok', data: Array.from({ length: n }, () => ({})) }),
  capturadaEn: '2026-09-03T10:00:00Z',
})

/** El marcador de fin real del feed: `status: "end"`, sin `data`, `nEventos: 0`. */
const pFin = (offset: number): Captura => ({
  recoleccion: 'r1',
  offset,
  nEventos: 0,
  cuerpo: JSON.stringify({ status: 'end' }),
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

describe('comprobarCompletitud', () => {
  it('acepta cuando la última captura es el marcador de fin del feed', () => {
    expect(() => comprobarCompletitud([pOk(0, 21), pFin(21)])).not.toThrow()
  })

  it('acepta una única captura que ya es el marcador de fin', () => {
    expect(() => comprobarCompletitud([pFin(0)])).not.toThrow()
  })

  it('lanza si la última captura no es "status":"end"', () => {
    expect(() => comprobarCompletitud([pOk(0, 21), pOk(21, 3)])).toThrow(RecoleccionIncompletaError)
  })

  it('lanza si la única captura no es "status":"end"', () => {
    expect(() => comprobarCompletitud([pOk(0, 21)])).toThrow(RecoleccionIncompletaError)
  })

  it('lanza con una lista vacía: no hay ningún marcador de fin que comprobar', () => {
    expect(() => comprobarCompletitud([])).toThrow(RecoleccionIncompletaError)
  })

  it('lanza si la última captura dice "status":"end" pero su nEventos guardado no es 0', () => {
    // Forma que `contarEventosBrutos` nunca produciría junta, pero que aquí se
    // comprueba explícitamente en vez de fiarse solo del "status": el propio
    // enunciado exige las dos cosas.
    const finConEventosBrutos = { ...pFin(21), nEventos: 3 }
    expect(() => comprobarCompletitud([pOk(0, 21), finConEventosBrutos])).toThrow(RecoleccionIncompletaError)
  })

  it('el error menciona la recolección y por qué no se da por completa', () => {
    try {
      comprobarCompletitud([pOk(0, 21), pOk(21, 3)])
      expect.unreachable('debería haber lanzado')
    } catch (e) {
      expect(e).toBeInstanceOf(RecoleccionIncompletaError)
      expect((e as Error).message).toMatch(/r1/)
      expect((e as Error).message).toMatch(/no.*complet/i)
    }
  })
})
