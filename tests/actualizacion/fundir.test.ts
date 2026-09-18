import { describe, expect, it } from 'vitest'
import { fundir } from '../../src/actualizacion/recolectar.js'
import type { PaginaCruda } from '../../src/actualizacion/feed.js'

const pagina = (offset: number, cuerpo: string, capturadaEn: string): PaginaCruda => ({ offset, cuerpo, capturadaEn })

describe('fundir', () => {
  it('añade páginas nuevas a las que ya había', () => {
    const volcado = fundir({ paginas: [pagina(0, 'a', '2026-09-01')] }, [pagina(50, 'b', '2026-09-02')])
    expect(volcado.paginas.map((p) => p.offset)).toEqual([0, 50])
  })

  it('no repite el mismo offset dos veces: se queda con la captura más reciente', () => {
    // Es justo lo que pasa cuando el hueco de historia no se puede rellenar
    // nunca —el primer traspaso real de Mister es de después del reinicio de
    // la liga— y cada pasada vuelve a bajar el feed entero: sin esto, el
    // volcado cacheado se apila sin fin hasta reventar.
    const volcado = fundir(
      { paginas: [pagina(0, 'primera bajada', '2026-09-01'), pagina(50, 'primera bajada', '2026-09-01')] },
      [pagina(0, 'segunda bajada', '2026-09-02'), pagina(50, 'segunda bajada', '2026-09-02')],
    )
    expect(volcado.paginas).toHaveLength(2)
    expect(volcado.paginas.map((p) => p.cuerpo)).toEqual(['segunda bajada', 'segunda bajada'])
  })

  it('con offsets repetidos varias veces seguidas, el tamaño no crece', () => {
    let volcado = { paginas: [] as PaginaCruda[] }
    const mismasPaginas = [pagina(0, 'x'.repeat(1000), '2026-09-01'), pagina(50, 'y'.repeat(1000), '2026-09-01')]
    for (let i = 0; i < 20; i += 1) volcado = fundir(volcado, mismasPaginas)
    expect(volcado.paginas).toHaveLength(2)
  })

  it('mantiene el orden de aparición: los offsets nuevos van al final', () => {
    const volcado = fundir(
      { paginas: [pagina(50, 'b', '2026-09-01'), pagina(0, 'a', '2026-09-01')] },
      [pagina(0, 'a repetida', '2026-09-02'), pagina(100, 'c', '2026-09-02')],
    )
    expect(volcado.paginas.map((p) => p.offset)).toEqual([50, 0, 100])
  })
})
