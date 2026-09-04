import { describe, expect, it } from 'vitest'
import { podar, subidasDelMes, type Historico } from '../../src/actualizacion/historicoValores.js'

/** Un histórico de `dias` días acabando en `hoy`, con un jugador que sube 1000 al día. */
const serie = (hoy: string, dias: number): Historico => {
  const h: Historico = {}
  for (let i = dias - 1; i >= 0; i -= 1) {
    const d = new Date(`${hoy}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - i)
    h[d.toISOString().slice(0, 10)] = { '7': 1_000_000 + (dias - 1 - i) * 1000 }
  }
  return h
}

describe('subidasDelMes', () => {
  it('compara con la foto de hace un mes', () => {
    // 31 días de recorrido: la referencia es la de hace 30, o sea 30.000 menos.
    expect(subidasDelMes(serie('2026-09-04', 31), '2026-09-04').get('7')).toBe(30_000)
  })

  it('con menos de tres semanas de recorrido no dice nada', () => {
    // Existiría una cifra, pero llamarla «del mes» sería mentir por omisión.
    expect(subidasDelMes(serie('2026-09-04', 15), '2026-09-04').size).toBe(0)
  })

  it('con tres semanas justas ya vale, y compara con lo más viejo que hay', () => {
    expect(subidasDelMes(serie('2026-09-04', 22), '2026-09-04').get('7')).toBe(21_000)
  })

  it('un jugador que no estaba hace un mes se queda fuera', () => {
    // Contarlo como si hubiera subido su valor entero lo pondría el primero de
    // la lista de «los que más suben», que es justo lo contrario de la verdad.
    const h = serie('2026-09-04', 31)
    h['2026-09-04']!['99'] = 5_000_000
    const r = subidasDelMes(h, '2026-09-04')
    expect(r.has('99')).toBe(false)
    expect(r.has('7')).toBe(true)
  })

  it('sin histórico devuelve vacío en vez de romper', () => {
    expect(subidasDelMes({}, '2026-09-04').size).toBe(0)
  })

  it('un día de hoy que no está tampoco rompe', () => {
    expect(subidasDelMes(serie('2026-09-03', 31), '2026-09-04').size).toBe(0)
  })
})

describe('podar', () => {
  it('deja solo los días más recientes', () => {
    const h = serie('2026-09-04', 50)
    podar(h, 40)
    const dias = Object.keys(h).sort()
    expect(dias).toHaveLength(40)
    expect(dias[0]).toBe('2026-07-27')
    expect(dias[39]).toBe('2026-09-04')
  })

  it('con menos días de los que caben no tira nada', () => {
    const h = serie('2026-09-04', 5)
    podar(h, 40)
    expect(Object.keys(h)).toHaveLength(5)
  })
})
