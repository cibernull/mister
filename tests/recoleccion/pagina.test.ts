import { describe, expect, it } from 'vitest'
import { abrirAlmacen } from '../../src/almacen/crudo.js'
import { contarEventosBrutos, procesarPagina } from '../../src/recoleccion/pagina.js'
import type { Resumen } from '../../src/recoleccion/pagina.js'

const ruido = (n: number) =>
  JSON.stringify({
    status: 'ok',
    data: Array.from({ length: n }, (_, i) => ({
      category: 'player_transfer',
      created: '2026-09-01 10:00:00',
      id: 1_000_000 + i,
      data: {},
    })),
  })

/** Lote final real: `status: "end"`, sin campo `data` en absoluto. */
const fin = JSON.stringify({ status: 'end' })

const resumenVacio = (recoleccion = 'r1'): Resumen => ({
  recoleccion,
  lotes: 0,
  eventos: 0,
  eventosBrutos: 0,
  contables: 0,
  ruido: 0,
  agotado: false,
})

describe('contarEventosBrutos', () => {
  it('cuenta el array "data" cuando status es "ok"', () => {
    expect(contarEventosBrutos(ruido(21))).toBe(21)
  })

  it('devuelve 0 para el marcador de fin ("status":"end", sin "data")', () => {
    expect(contarEventosBrutos(fin)).toBe(0)
  })

  it('lanza si el lote final ("status":"end") trae, contra lo esperado, un campo "data"', () => {
    expect(() => contarEventosBrutos(JSON.stringify({ status: 'end', data: [] }))).toThrow()
  })

  it('lanza en vez de contar cero eventos si falta el array "data" en cualquier otro status', () => {
    expect(() => contarEventosBrutos(JSON.stringify({ status: 'error' }))).toThrow(/forma esperada/i)
  })
})

describe('procesarPagina', () => {
  it('guarda la captura con el recuento de eventos brutos', () => {
    const almacen = abrirAlmacen(':memory:')
    const resumen = resumenVacio()
    procesarPagina(almacen, resumen, {
      recoleccion: 'r1',
      offset: 0,
      cuerpo: ruido(3),
      capturadaEn: '2026-09-03T10:00:00Z',
    })

    const capturas = almacen.leerCapturas('r1')
    expect(capturas).toHaveLength(1)
    expect(capturas[0]!.nEventos).toBe(3)
    almacen.cerrar()
  })

  it('acumula eventos, contables, ruido y eventos brutos sobre el resumen', () => {
    const almacen = abrirAlmacen(':memory:')
    const resumen = resumenVacio()
    procesarPagina(almacen, resumen, {
      recoleccion: 'r1',
      offset: 0,
      cuerpo: ruido(3),
      capturadaEn: '2026-09-03T10:00:00Z',
    })

    expect(resumen.lotes).toBe(1)
    expect(resumen.eventos).toBe(3)
    expect(resumen.eventosBrutos).toBe(3)
    expect(resumen.ruido).toBe(3)
    expect(resumen.contables).toBe(0)
    almacen.cerrar()
  })

  it('marca "agotado" en el resumen cuando el lote es el fin del feed, y no lo desmarca en lotes posteriores', () => {
    const almacen = abrirAlmacen(':memory:')
    const resumen = resumenVacio()
    procesarPagina(almacen, resumen, { recoleccion: 'r1', offset: 0, cuerpo: fin, capturadaEn: '2026-09-03T10:00:00Z' })

    expect(resumen.agotado).toBe(true)
    almacen.cerrar()
  })

  it('devuelve nEventos y agotado para que la llamante decida cómo avanzar', () => {
    const almacen = abrirAlmacen(':memory:')
    const resumen = resumenVacio()
    const resultado = procesarPagina(almacen, resumen, {
      recoleccion: 'r1',
      offset: 0,
      cuerpo: ruido(5),
      capturadaEn: '2026-09-03T10:00:00Z',
    })

    expect(resultado).toEqual({ nEventos: 5, agotado: false })
    almacen.cerrar()
  })
})
