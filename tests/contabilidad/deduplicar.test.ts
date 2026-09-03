import { describe, expect, it } from 'vitest'
import { DuplicadoConContenidoDistintoError, deduplicar } from '../../src/contabilidad/deduplicar.js'
import type { CierreJornada, Evento, Transaccion } from '../../src/dominio/eventos.js'

const tx = (idTransfer: number, fecha = '2026-08-10 10:00:00', importe = 1000): Transaccion => ({
  tipo: 'transaccion', idEvento: idTransfer, idTransfer, fecha,
  jugador: 'Jugador', origen: { clase: 'mercado' },
  destino: { clase: 'equipo', idUc: 5, nombre: 'Equipo' },
  importe, operacion: 'normal', idJugador: 999,
})

const cierre = (
  idJornada: number,
  fecha: string,
  opciones: { premio?: number; equipo?: string } = {},
): CierreJornada => ({
  tipo: 'cierreJornada', idEvento: idJornada, idJornada, jornada: 1, fecha,
  resultados: [{
    idUc: 5,
    equipo: opciones.equipo ?? 'Equipo',
    premio: opciones.premio ?? 100,
    puntos: 10,
    valorPlantilla: 900,
    sinPuntuar: false,
  }],
})

const ruido = (fecha: string): Evento => ({ tipo: 'ruido', idEvento: 0, fecha, motivo: 'x' })

describe('deduplicar', () => {
  it('deja pasar una lista sin repetidos', () => {
    expect(deduplicar([tx(1), tx(2)])).toHaveLength(2)
  })

  it('elimina movimientos con el mismo idTransfer cuando son idénticos (repetición legítima de paginación)', () => {
    const r = deduplicar([tx(1), tx(2), tx(1)])
    expect(r).toHaveLength(2)
    expect(r.filter((e) => e.tipo === 'transaccion').map((e) => (e as Transaccion).idTransfer)).toEqual([1, 2])
  })

  it('conserva la PRIMERA aparición de un movimiento repetido idéntico', () => {
    const r = deduplicar([tx(1, '2026-08-10 10:00:00'), tx(1, '2026-08-10 10:00:00')])
    expect(r).toHaveLength(1)
    expect((r[0] as Transaccion).fecha).toBe('2026-08-10 10:00:00')
  })

  it('lanza si dos movimientos comparten idTransfer con importe distinto', () => {
    expect(() => deduplicar([tx(1, '2026-08-10 10:00:00', 1000), tx(1, '2026-08-10 10:00:00', 2000)]))
      .toThrow(DuplicadoConContenidoDistintoError)
  })

  it('lanza si dos movimientos comparten idTransfer con fecha distinta', () => {
    // Una repetición legítima por paginación sirve de nuevo el mismo evento
    // crudo: la fecha no puede diferir. Si difiere, es un dato corregido o
    // una lectura mal hecha, no la misma repetición de siempre.
    expect(() => deduplicar([tx(1, '2026-08-10 10:00:00'), tx(1, '2026-08-12 10:00:00')]))
      .toThrow(DuplicadoConContenidoDistintoError)
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

  it('un cierre repetido con el nombre de equipo distinto (renombre entre ambas publicaciones) NO lanza', () => {
    // La identidad del equipo es idUc, no el nombre (hallazgo 3): un
    // `change_name` entre las dos apariciones del mismo cierre es legítimo y
    // no debe tratarse como contenido distinto.
    const r = deduplicar([
      cierre(3968, '2026-08-20 12:00:00', { equipo: 'Rafael manda' }),
      cierre(3968, '2026-08-28 10:00:00', { equipo: 'Cacaculopedopis' }),
    ])
    expect(r).toHaveLength(1)
  })

  it('lanza si dos cierres comparten idJornada con premios distintos', () => {
    expect(() => deduplicar([
      cierre(3968, '2026-08-20 12:00:00', { premio: 100 }),
      cierre(3968, '2026-08-28 10:00:00', { premio: 999 }),
    ])).toThrow(DuplicadoConContenidoDistintoError)
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
