import { describe, expect, it } from 'vitest'
import { abrirAlmacen } from '../../src/almacen/crudo.js'

const almacenEnMemoria = () => abrirAlmacen(':memory:')

const pagina = (offset: number, nEventos: number, cuerpo = '{}') => ({
  offset,
  nEventos,
  cuerpo,
  capturadaEn: '2026-09-03T10:00:00Z',
})

describe('almacén crudo', () => {
  it('guarda y recupera una página íntegra', () => {
    const a = almacenEnMemoria()
    a.guardarPagina(pagina(0, 21, '{"a":1}'))
    expect(a.leerPaginas()).toEqual([
      { offset: 0, nEventos: 21, cuerpo: '{"a":1}', capturadaEn: '2026-09-03T10:00:00Z' },
    ])
    a.cerrar()
  })

  it('devuelve las páginas ordenadas por offset', () => {
    const a = almacenEnMemoria()
    a.guardarPagina(pagina(42, 21))
    a.guardarPagina(pagina(0, 21))
    a.guardarPagina(pagina(21, 21))
    expect(a.leerPaginas().map((p) => p.offset)).toEqual([0, 21, 42])
    a.cerrar()
  })

  it('reguardar un offset lo sustituye en vez de duplicarlo', () => {
    const a = almacenEnMemoria()
    a.guardarPagina(pagina(0, 21, 'viejo'))
    a.guardarPagina(pagina(0, 21, 'nuevo'))
    const ps = a.leerPaginas()
    expect(ps).toHaveLength(1)
    expect(ps[0]!.cuerpo).toBe('nuevo')
    a.cerrar()
  })

  it('no altera el cuerpo guardado', () => {
    const a = almacenEnMemoria()
    const raro = '{"texto":"acentos áéí, emoji 🏆, comillas \\" y salto\\n"}'
    a.guardarPagina(pagina(0, 1, raro))
    expect(a.leerPaginas()[0]!.cuerpo).toBe(raro)
    a.cerrar()
  })
})
