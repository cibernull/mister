import { describe, expect, it } from 'vitest'
import { CapturaDuplicadaError, abrirAlmacen } from '../../src/almacen/crudo.js'

const almacenEnMemoria = () => abrirAlmacen(':memory:')

const captura = (offset: number, nEventos: number, cuerpo = '{}', recoleccion = 'r1') => ({
  recoleccion,
  offset,
  nEventos,
  cuerpo,
  capturadaEn: '2026-09-03T10:00:00Z',
})

describe('almacén crudo', () => {
  it('guarda y recupera una captura íntegra', () => {
    const a = almacenEnMemoria()
    a.guardarCaptura(captura(0, 21, '{"a":1}'))
    expect(a.leerCapturas('r1')).toEqual([
      {
        recoleccion: 'r1',
        offset: 0,
        nEventos: 21,
        cuerpo: '{"a":1}',
        capturadaEn: '2026-09-03T10:00:00Z',
      },
    ])
    a.cerrar()
  })

  it('devuelve las capturas ordenadas por offset', () => {
    const a = almacenEnMemoria()
    a.guardarCaptura(captura(42, 21))
    a.guardarCaptura(captura(0, 21))
    a.guardarCaptura(captura(21, 21))
    expect(a.leerCapturas('r1').map((c) => c.offset)).toEqual([0, 21, 42])
    a.cerrar()
  })

  it('no altera el cuerpo guardado', () => {
    const a = almacenEnMemoria()
    const raro = '{"texto":"acentos áéí, emoji 🏆, comillas \" y salto\n"}'
    a.guardarCaptura(captura(0, 1, raro))
    expect(a.leerCapturas('r1')[0]!.cuerpo).toBe(raro)
    a.cerrar()
  })

  it('rechaza duplicar el mismo offset dentro de una recolección', () => {
    const a = almacenEnMemoria()
    a.guardarCaptura(captura(0, 21, 'primero'))
    expect(() => a.guardarCaptura(captura(0, 21, 'segundo'))).toThrow(CapturaDuplicadaError)
    a.cerrar()
  })

  it('el duplicado no destruye la captura original', () => {
    const a = almacenEnMemoria()
    a.guardarCaptura(captura(0, 21, 'primero'))
    try {
      a.guardarCaptura(captura(0, 21, 'segundo'))
    } catch {
      // esperado
    }
    expect(a.leerCapturas('r1')).toHaveLength(1)
    expect(a.leerCapturas('r1')[0]!.cuerpo).toBe('primero')
    a.cerrar()
  })

  it('admite el mismo offset en recolecciones distintas', () => {
    const a = almacenEnMemoria()
    a.guardarCaptura(captura(0, 21, 'de ayer', 'r1'))
    a.guardarCaptura(captura(0, 25, 'de hoy', 'r2'))
    expect(a.leerCapturas('r1')[0]!.cuerpo).toBe('de ayer')
    expect(a.leerCapturas('r2')[0]!.cuerpo).toBe('de hoy')
    a.cerrar()
  })

  it('lista las recolecciones guardadas', () => {
    const a = almacenEnMemoria()
    a.guardarCaptura(captura(0, 1, '{}', 'r1'))
    a.guardarCaptura(captura(0, 1, '{}', 'r2'))
    expect(a.recolecciones().sort()).toEqual(['r1', 'r2'])
    a.cerrar()
  })

  it('devuelve vacío para una recolección desconocida', () => {
    const a = almacenEnMemoria()
    expect(a.leerCapturas('no-existe')).toEqual([])
    a.cerrar()
  })

  it('rechaza un offset negativo', () => {
    const a = almacenEnMemoria()
    expect(() => a.guardarCaptura(captura(-1, 21))).toThrow(/offset/i)
    a.cerrar()
  })

  it('rechaza un nEventos negativo', () => {
    const a = almacenEnMemoria()
    expect(() => a.guardarCaptura(captura(0, -1))).toThrow(/nEventos/i)
    a.cerrar()
  })

  it('rechaza un nEventos no entero', () => {
    const a = almacenEnMemoria()
    expect(() => a.guardarCaptura(captura(0, 2.5))).toThrow(/nEventos/i)
    a.cerrar()
  })
})
