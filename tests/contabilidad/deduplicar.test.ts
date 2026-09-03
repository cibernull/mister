import { describe, expect, it } from 'vitest'
import { deduplicar } from '../../src/contabilidad/deduplicar.js'
import type { CierreJornada, Evento, Transaccion } from '../../src/dominio/eventos.js'

const tx = (idTransfer: number, fecha = '2026-08-10 10:00:00'): Transaccion => ({
  tipo: 'transaccion', idEvento: idTransfer, idTransfer, fecha,
  jugador: 'Jugador', origen: { clase: 'mercado' },
  destino: { clase: 'equipo', idUc: 5, nombre: 'Equipo' },
  importe: 1000, operacion: 'normal', idJugador: 999,
})

const cierre = (idJornada: number, fecha: string): CierreJornada => ({
  tipo: 'cierreJornada', idEvento: idJornada, idJornada, jornada: 1, fecha,
  resultados: [{ idUc: 5, equipo: 'Equipo', premio: 100, puntos: 10, valorPlantilla: 900, sinPuntuar: false }],
})

const ruido = (fecha: string): Evento => ({ tipo: 'ruido', idEvento: 0, fecha, motivo: 'x' })

describe('deduplicar', () => {
  it('deja pasar una lista sin repetidos', () => {
    expect(deduplicar([tx(1), tx(2)])).toHaveLength(2)
  })

  it('elimina movimientos con el mismo idTransfer', () => {
    const r = deduplicar([tx(1), tx(2), tx(1)])
    expect(r).toHaveLength(2)
    expect(r.filter((e) => e.tipo === 'transaccion').map((e) => (e as Transaccion).idTransfer)).toEqual([1, 2])
  })

  it('conserva la PRIMERA aparición de un movimiento repetido', () => {
    const r = deduplicar([tx(1, '2026-08-10 10:00:00'), tx(1, '2026-08-12 10:00:00')])
    expect((r[0] as Transaccion).fecha).toBe('2026-08-10 10:00:00')
  })

  it('elimina cierres con el mismo idJornada', () => {
    expect(deduplicar([cierre(3968, '2026-08-20 12:00:00'), cierre(3968, '2026-08-28 10:00:00')])).toHaveLength(1)
  })

  it('de un cierre duplicado conserva el MÁS ANTIGUO, venga en el orden que venga', () => {
    const tarde = cierre(3968, '2026-08-28 10:00:00')
    const pronto = cierre(3968, '2026-08-20 12:00:00')
    expect((deduplicar([tarde, pronto])[0] as CierreJornada).fecha).toBe('2026-08-20 12:00:00')
    expect((deduplicar([pronto, tarde])[0] as CierreJornada).fecha).toBe('2026-08-20 12:00:00')
  })

  it('no confunde un movimiento con un cierre que compartan número', () => {
    expect(deduplicar([tx(7), cierre(7, '2026-08-20 12:00:00')])).toHaveLength(2)
  })

  it('no deduplica el ruido', () => {
    expect(deduplicar([ruido('2026-08-01 10:00:00'), ruido('2026-08-01 10:00:00')])).toHaveLength(2)
  })

  it('acepta una lista vacía', () => {
    expect(deduplicar([])).toEqual([])
  })
})
