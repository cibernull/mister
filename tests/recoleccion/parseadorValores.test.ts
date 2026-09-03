import { describe, expect, it } from 'vitest'
import { SerieVaciaError, parsearSerieValores, valorEn } from '../../src/recoleccion/parseadorValores.js'

const con = (pares: [string, string][]) =>
  `<html><script>var x = [${pares.map(([v, d]) => `{"value":"${v}","date":"${d}"}`).join(',')}];</script></html>`

describe('parsearSerieValores', () => {
  it('extrae los puntos con la fecha en ISO', () => {
    expect(parsearSerieValores(con([['6792000', '3 ago 2026']]))).toEqual([{ fecha: '2026-08-03', valor: 6792000 }])
  })

  it('traduce los doce meses del castellano abreviado', () => {
    const meses: [string, string][] = [
      ['1', '1 ene 2026'], ['2', '1 feb 2026'], ['3', '1 mar 2026'], ['4', '1 abr 2026'],
      ['5', '1 may 2026'], ['6', '1 jun 2026'], ['7', '1 jul 2026'], ['8', '1 ago 2026'],
      ['9', '1 sep 2026'], ['10', '1 oct 2026'], ['11', '1 nov 2026'], ['12', '1 dic 2026'],
    ]
    const s = parsearSerieValores(con(meses))
    expect(s.map((p) => p.fecha.slice(5, 7))).toEqual(
      ['01','02','03','04','05','06','07','08','09','10','11','12'])
  })

  it('rellena con cero el día de una cifra', () => {
    expect(parsearSerieValores(con([['1', '3 ago 2026']]))[0]!.fecha).toBe('2026-08-03')
  })

  it('elimina fechas repetidas quedándose con la primera', () => {
    const s = parsearSerieValores(con([['100', '3 ago 2026'], ['200', '3 ago 2026']]))
    expect(s).toHaveLength(1)
    expect(s[0]!.valor).toBe(100)
  })

  it('devuelve la serie ordenada cronológicamente', () => {
    const s = parsearSerieValores(con([['2', '5 ago 2026'], ['1', '3 ago 2026'], ['3', '7 ago 2026']]))
    expect(s.map((p) => p.valor)).toEqual([1, 2, 3])
  })

  it('lanza si un mes no se reconoce', () => {
    expect(() => parsearSerieValores(con([['1', '3 xxx 2026']]))).toThrow(/mes/i)
  })

  it('lanza si la página no trae ningún punto', () => {
    expect(() => parsearSerieValores('<html>nada</html>')).toThrow(SerieVaciaError)
  })

  it('lanza si un punto trae un valor no numérico, en vez de desaparecer de la serie en silencio', () => {
    // Junto a un punto válido: si el inválido desapareciera en silencio, esto
    // NO lanzaría (la serie tendría igualmente su único punto válido) — la
    // prueba deja de depender de que la serie quede vacía.
    expect(() =>
      parsearSerieValores(con([['100', '3 ago 2026'], ['N/A', '4 ago 2026']])),
    ).toThrow(/valor/i)
  })

  it('lanza si un punto trae el valor vacío', () => {
    expect(() =>
      parsearSerieValores(con([['100', '3 ago 2026'], ['', '4 ago 2026']])),
    ).toThrow(/valor/i)
  })

  it('el punto inválido no desaparece silenciosamente dejando pasar solo los válidos', () => {
    let error: Error | undefined
    try {
      parsearSerieValores(con([['100', '3 ago 2026'], ['N/A', '4 ago 2026'], ['300', '5 ago 2026']]))
    } catch (e) {
      error = e as Error
    }
    expect(error, 'debería haber lanzado en vez de devolver una serie con huecos').toBeDefined()
    expect(error).not.toBeInstanceOf(SerieVaciaError)
  })
})

describe('valorEn', () => {
  const serie = parsearSerieValores(con([['100', '3 ago 2026'], ['200', '5 ago 2026']]))

  it('devuelve el valor de una fecha presente', () => {
    expect(valorEn(serie, '2026-08-03')).toBe(100)
  })

  it('devuelve null si la fecha no está en la serie', () => {
    expect(valorEn(serie, '2026-08-04')).toBe(null)
  })
})
