import { describe, expect, it } from 'vitest'
import {
  chequearInstantes, elegirRecoleccion, jugadoresNecesarios, verificarFechaReinicio,
} from '../../src/cli/analizar.js'
import type { CandidatoRecoleccion } from '../../src/cli/analizar.js'
import type { Evento, Ruido, Transaccion } from '../../src/dominio/eventos.js'

let n = 0
const mov = (idJugador: number, deIdUc: number | null, aIdUc: number | null, fecha = '2026-08-05 10:00:00'): Transaccion => ({
  tipo: 'transaccion', idEvento: ++n, idTransfer: n, fecha, jugador: 'J' + idJugador, idJugador,
  origen: deIdUc === null ? { clase: 'mercado' } : { clase: 'equipo', idUc: deIdUc, nombre: 'E' + deIdUc },
  destino: aIdUc === null ? { clase: 'mercado' } : { clase: 'equipo', idUc: aIdUc, nombre: 'E' + aIdUc },
  importe: 100, operacion: 'normal',
})

const baja = (idJugador: number, fecha = '2026-08-10 10:00:00'): Evento => ({
  tipo: 'bajaPlantilla', idEvento: ++n, fecha, idJugador, jugador: 'J' + idJugador,
})

const ruidoAdmin = (fecha: string): Ruido => ({
  tipo: 'ruido', idEvento: ++n, fecha, motivo: 'categoría sin efecto contable: admin',
})

const ruidoOtro = (fecha: string): Ruido => ({
  tipo: 'ruido', idEvento: ++n, fecha, motivo: 'categoría sin efecto contable: post',
})

describe('elegirRecoleccion', () => {
  it('lanza si no hay ninguna recolección completa', () => {
    const candidatos: CandidatoRecoleccion[] = [
      { nombre: 'a', veredicto: { nombre: 'a', completa: false, marcadaEn: '2026-01-01T00:00:00Z' } },
    ]
    expect(() => elegirRecoleccion(candidatos)).toThrow(/no hay ninguna recolección completa/i)
  })

  it('lanza si no hay ninguna recolección en absoluto', () => {
    expect(() => elegirRecoleccion([])).toThrow(/no hay ninguna recolección completa/i)
  })

  it('el mensaje de error indica cuántas recolecciones incompletas hay', () => {
    const candidatos: CandidatoRecoleccion[] = [
      { nombre: 'a', veredicto: { nombre: 'a', completa: false, marcadaEn: '2026-01-01T00:00:00Z' } },
      { nombre: 'b', veredicto: undefined },
    ]
    expect(() => elegirRecoleccion(candidatos)).toThrow(/2 incompletas/)
  })

  // Crítico 2: `leerCompletitud` devuelve un objeto, y `{ completa: false }`
  // es truthy en JavaScript. Un filtro que solo comprobara "¿hay veredicto?"
  // dejaría pasar una recolección marcada como incompleta.
  it('nunca elige una recolección marcada como incompleta, aunque sea la única con veredicto', () => {
    const candidatos: CandidatoRecoleccion[] = [
      { nombre: 'trunca', veredicto: { nombre: 'trunca', completa: false, marcadaEn: '2026-01-01T00:00:00Z' } },
      { nombre: 'sin-veredicto', veredicto: undefined },
    ]
    expect(() => elegirRecoleccion(candidatos)).toThrow(/no hay ninguna recolección completa/i)
  })

  // Importante 3: las recolecciones en vivo se llaman con una marca ISO
  // (`2026-...`) y las importaciones `volcado:<fichero>`. Como `"v" > "2"`,
  // elegir por nombre haría ganar siempre al volcado, por antiguo que fuera.
  it('elige por el instante de completitud, no por orden alfabético del nombre', () => {
    const candidatos: CandidatoRecoleccion[] = [
      { nombre: 'volcado:viejo.json', veredicto: { nombre: 'volcado:viejo.json', completa: true, marcadaEn: '2026-01-01T00:00:00Z' } },
      { nombre: '2026-06-01T00:00:00.000Z', veredicto: { nombre: '2026-06-01T00:00:00.000Z', completa: true, marcadaEn: '2026-06-01T00:00:05.000Z' } },
    ]
    expect(elegirRecoleccion(candidatos)).toBe('2026-06-01T00:00:00.000Z')
  })

  it('entre varias completas, elige la de marcadaEn más reciente', () => {
    const candidatos: CandidatoRecoleccion[] = [
      { nombre: 'a', veredicto: { nombre: 'a', completa: true, marcadaEn: '2026-01-01T00:00:00Z' } },
      { nombre: 'b', veredicto: { nombre: 'b', completa: true, marcadaEn: '2026-03-01T00:00:00Z' } },
      { nombre: 'c', veredicto: { nombre: 'c', completa: true, marcadaEn: '2026-02-01T00:00:00Z' } },
    ]
    expect(elegirRecoleccion(candidatos)).toBe('b')
  })

  it('ignora las incompletas al elegir entre varias, aunque sean más recientes', () => {
    const candidatos: CandidatoRecoleccion[] = [
      { nombre: 'completa-vieja', veredicto: { nombre: 'completa-vieja', completa: true, marcadaEn: '2026-01-01T00:00:00Z' } },
      { nombre: 'incompleta-nueva', veredicto: { nombre: 'incompleta-nueva', completa: false, marcadaEn: '2026-05-01T00:00:00Z' } },
    ]
    expect(elegirRecoleccion(candidatos)).toBe('completa-vieja')
  })
})

describe('jugadoresNecesarios', () => {
  it('incluye los jugadores mencionados en transacciones', () => {
    expect(jugadoresNecesarios([mov(10, 1, null)], new Map())).toEqual([10])
  })

  it('incluye los jugadores mencionados en bajas de plantilla', () => {
    expect(jugadoresNecesarios([baja(20)], new Map())).toEqual([20])
  })

  // Crítico 1: un jugador comprado y todavía en plantilla no aparece en
  // ningún reparto inicial (lo compró, no lo heredó), pero su ficha SÍ hace
  // falta para el valor de la plantilla actual. Antes de esta función, solo
  // se pedían las fichas de los jugadores del reparto.
  it('incluye TODOS los jugadores de las plantillas actuales, aunque no aparezcan en ningún evento', () => {
    const ids = jugadoresNecesarios([], new Map([[1, [30, 31]]]))
    expect(ids.sort()).toEqual([30, 31])
  })

  it('une eventos y plantillas sin repetir', () => {
    const ids = jugadoresNecesarios([mov(10, 1, null)], new Map([[1, [10, 11]]]))
    expect(ids.sort()).toEqual([10, 11])
  })

  it('un jugador comprado (no del reparto) y todavía en plantilla se pide igualmente', () => {
    // 40: el equipo 1 lo compró (mov con destino 1) y lo conserva. No sería
    // parte de ningún reparto inicial, pero su ficha hace falta para el
    // valor de la plantilla actual.
    const eventos = [mov(40, null, 1)]
    const ids = jugadoresNecesarios(eventos, new Map([[1, [40]]]))
    expect(ids).toContain(40)
  })

  it('no devuelve nada si no hay eventos ni plantillas', () => {
    expect(jugadoresNecesarios([], new Map())).toEqual([])
  })
})

describe('chequearInstantes', () => {
  it('lanza si no hay capturas del histórico', () => {
    expect(() => chequearInstantes([], ['2026-01-01T00:00:00Z'])).toThrow(/histórico/)
  })

  it('lanza si no hay páginas auxiliares', () => {
    expect(() => chequearInstantes(['2026-01-01T00:00:00Z'], [])).toThrow(/auxiliar/)
  })

  it('toma el más reciente del histórico y el más antiguo de los auxiliares', () => {
    const r = chequearInstantes(
      ['2026-08-01T00:00:00Z', '2026-08-03T00:00:00Z'],
      ['2026-09-01T08:00:00Z', '2026-09-01T02:00:00Z'],
    )
    expect(r.instanteHistorico).toBe('2026-08-03T00:00:00Z')
    expect(r.instanteAuxiliarMasAntiguo).toBe('2026-09-01T02:00:00Z')
  })

  it('no destaca un desfase pequeño', () => {
    const r = chequearInstantes(['2026-09-01T00:00:00Z'], ['2026-09-01T02:00:00Z'])
    expect(r.destacar).toBe(false)
  })

  it('destaca un desfase de varios días', () => {
    const r = chequearInstantes(['2026-08-01T00:00:00Z'], ['2026-09-01T00:00:00Z'])
    expect(r.destacar).toBe(true)
    expect(r.desfaseMs).toBeGreaterThan(0)
  })

  it('el desfase es siempre positivo, sea el histórico anterior o posterior al auxiliar', () => {
    const a = chequearInstantes(['2026-08-01T00:00:00Z'], ['2026-09-01T00:00:00Z'])
    const b = chequearInstantes(['2026-09-01T00:00:00Z'], ['2026-08-01T00:00:00Z'])
    expect(a.desfaseMs).toBe(b.desfaseMs)
  })
})

describe('verificarFechaReinicio', () => {
  it('no es verificable si no hay ningún evento admin', () => {
    const r = verificarFechaReinicio([ruidoOtro('2026-08-03 06:17:52')], '2026-08-03')
    expect(r.verificable).toBe(false)
  })

  it('coincide cuando el admin más antiguo cae en la fecha esperada', () => {
    const r = verificarFechaReinicio([ruidoAdmin('2026-08-03 06:17:52')], '2026-08-03')
    expect(r).toEqual({ verificable: true, fechaHallada: '2026-08-03', coincide: true })
  })

  it('no coincide si el admin más antiguo cae en otra fecha', () => {
    const r = verificarFechaReinicio([ruidoAdmin('2026-08-05 06:17:52')], '2026-08-03')
    expect(r.verificable).toBe(true)
    if (r.verificable) {
      expect(r.coincide).toBe(false)
      expect(r.fechaHallada).toBe('2026-08-05')
    }
  })

  // Refleja el histórico real: dos eventos admin, "reset-all" el más
  // antiguo y otro (p. ej. activar/desactivar el capitán) mucho después.
  it('usa el admin MÁS ANTIGUO cuando hay varios', () => {
    const r = verificarFechaReinicio(
      [ruidoAdmin('2026-08-20 20:42:21'), ruidoAdmin('2026-08-03 06:17:52')],
      '2026-08-03',
    )
    expect(r).toEqual({ verificable: true, fechaHallada: '2026-08-03', coincide: true })
  })

  it('ignora eventos ruido que no son admin', () => {
    const r = verificarFechaReinicio([ruidoOtro('2026-08-03 06:17:52'), ruidoAdmin('2026-08-10 00:00:00')], '2026-08-03')
    expect(r.verificable).toBe(true)
    if (r.verificable) expect(r.fechaHallada).toBe('2026-08-10')
  })
})
