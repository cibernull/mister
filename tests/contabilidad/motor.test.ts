import { describe, expect, it } from 'vitest'
import { calcularEstado, calcularValorPlantillaActual } from '../../src/contabilidad/motor.js'
import type { Evento, Transaccion } from '../../src/dominio/eventos.js'
import type { RepartoEquipo } from '../../src/contabilidad/reparto.js'
import type { PuntoValor } from '../../src/recoleccion/parseadorValores.js'

const REINICIO = '2026-08-03'
let n = 0

const mov = (idJugador: number, deIdUc: number | null, aIdUc: number | null, importe: number, fecha: string): Transaccion => ({
  tipo: 'transaccion', idEvento: ++n, idTransfer: n, fecha, jugador: 'J', idJugador,
  origen: deIdUc === null ? { clase: 'mercado' } : { clase: 'equipo', idUc: deIdUc, nombre: 'E' },
  destino: aIdUc === null ? { clase: 'mercado' } : { clase: 'equipo', idUc: aIdUc, nombre: 'E' },
  importe, operacion: 'normal',
})

const cierre = (fecha: string, premios: [number, number][]): Evento => ({
  tipo: 'cierreJornada', idEvento: ++n, idJornada: n, jornada: 1, fecha,
  resultados: premios.map(([idUc, premio]) => ({ idUc, equipo: 'E', premio, puntos: 5, valorPlantilla: 0, sinPuntuar: false })),
})

const reparto = (idUc: number, jugadores: number[]): RepartoEquipo =>
  ({ idUc, nombre: 'E' + idUc, jugadores, porVenta: jugadores, porPlantilla: [], porBaja: [] })

const serie = (valor: number): PuntoValor[] => [{ fecha: REINICIO, valor }]

const base = {
  fechaReinicio: REINICIO,
  presupuestoInicial: 50_000_000,
  coeficienteTope: 0.25,
  valorPlantillaActual: new Map([[1, 40_000_000]]),
}

describe('calcularEstado', () => {
  it('el saldo inicial es el presupuesto menos el valor del reparto', () => {
    const e = calcularEstado({ ...base, eventos: [], repartos: new Map([[1, reparto(1, [10, 11])]]),
      valores: new Map([[10, serie(20_000_000)], [11, serie(5_000_000)]]) })
    expect(e.get(1)!.valorReparto).toBe(25_000_000)
    expect(e.get(1)!.saldoInicial).toBe(25_000_000)
  })

  it('suma las ventas y resta las compras', () => {
    const eventos = [mov(10, 1, null, 3_000_000, '2026-08-10 10:00:00'), mov(20, null, 1, 1_000_000, '2026-08-11 10:00:00')]
    const e = calcularEstado({ ...base, eventos, repartos: new Map([[1, reparto(1, [10])]]), valores: new Map([[10, serie(10_000_000)]]) })
    expect(e.get(1)!.ventas).toBe(3_000_000)
    expect(e.get(1)!.compras).toBe(1_000_000)
    expect(e.get(1)!.saldo).toBe(40_000_000 + 3_000_000 - 1_000_000)
  })

  it('suma los premios de jornada', () => {
    const e = calcularEstado({ ...base, eventos: [cierre('2026-08-20 12:00:00', [[1, 750_000]])],
      repartos: new Map([[1, reparto(1, [10])]]), valores: new Map([[10, serie(10_000_000)]]) })
    expect(e.get(1)!.premios).toBe(750_000)
    expect(e.get(1)!.saldo).toBe(40_750_000)
  })

  it('el tope de puja es el saldo más el coeficiente por el valor de plantilla', () => {
    const e = calcularEstado({ ...base, eventos: [], repartos: new Map([[1, reparto(1, [10])]]), valores: new Map([[10, serie(10_000_000)]]) })
    expect(e.get(1)!.topePuja).toBe(40_000_000 + 0.25 * 40_000_000)
  })

  it('un traspaso entre equipos suma al vendedor y resta al comprador', () => {
    const eventos = [mov(10, 1, 2, 2_000_000, '2026-08-10 10:00:00')]
    const e = calcularEstado({ ...base,
      valorPlantillaActual: new Map([[1, 0], [2, 0]]), eventos,
      repartos: new Map([[1, reparto(1, [])], [2, reparto(2, [])]]), valores: new Map() })
    expect(e.get(1)!.ventas).toBe(2_000_000)
    expect(e.get(2)!.compras).toBe(2_000_000)
  })

  it('ignora los eventos posteriores a la fecha de corte', () => {
    const eventos = [mov(10, 1, null, 5_000_000, '2026-08-25 10:00:00')]
    const e = calcularEstado({ ...base, eventos, hasta: '2026-08-20 00:00:00',
      repartos: new Map([[1, reparto(1, [])]]), valores: new Map() })
    expect(e.get(1)!.ventas).toBe(0)
  })

  it('declara los jugadores sin valor en vez de contarlos como cero', () => {
    const e = calcularEstado({ ...base, eventos: [], repartos: new Map([[1, reparto(1, [10, 99])]]),
      valores: new Map([[10, serie(10_000_000)]]) })
    expect(e.get(1)!.jugadoresSinValor).toEqual([99])
    expect(e.get(1)!.valorReparto).toBe(10_000_000)
  })

  it('el dinero se mantiene entero en todo el cálculo', () => {
    const e = calcularEstado({ ...base, eventos: [mov(10, 1, null, 1_234_567, '2026-08-10 10:00:00')],
      repartos: new Map([[1, reparto(1, [10])]]), valores: new Map([[10, serie(9_999_999)]]) })
    for (const v of [e.get(1)!.saldo, e.get(1)!.saldoInicial, e.get(1)!.valorReparto]) {
      expect(Number.isInteger(v)).toBe(true)
    }
  })
})

describe('calcularValorPlantillaActual', () => {
  // Serie con dos puntos: el valor "actual" es el ÚLTIMO, no el del reinicio.
  const serieActual = (...valores: number[]): PuntoValor[] =>
    valores.map((valor, i) => ({ fecha: `2026-08-0${i + 1}`, valor }))

  it('suma el último valor conocido de cada jugador de la plantilla', () => {
    const r = calcularValorPlantillaActual(
      new Map([[1, [10, 11]]]),
      new Map([[10, serieActual(1_000, 5_000)], [11, serieActual(2_000)]]),
    )
    expect(r.valorPlantillaActual.get(1)).toBe(5_000 + 2_000)
    expect(r.jugadoresSinValorActual.size).toBe(0)
  })

  it('un jugador COMPRADO y en plantilla, sin ficha descargada, cuenta su valor real (Crítico 1)', () => {
    // Antes de la corrección, un jugador comprado y todavía en plantilla no
    // pertenecía a ningún reparto inicial, así que `necesarios` (en
    // analizar.ts) nunca pedía su ficha: `valores` no traía su id, y su
    // aportación al total desaparecía en silencio (efecto idéntico a
    // contarlo como cero). Aquí se comprueba el lado del motor: SI la ficha
    // se pidió y está en `valores`, su valor cuenta en el total.
    const r = calcularValorPlantillaActual(
      new Map([[1, [10, 20]]]), // 20 es un jugador comprado, no del reparto
      new Map([[10, serieActual(1_000)], [20, serieActual(4_847_000)]]),
    )
    expect(r.valorPlantillaActual.get(1)).toBe(1_000 + 4_847_000)
  })

  it('un jugador de la plantilla sin serie de valores no cuenta como cero: se declara y se excluye', () => {
    const r = calcularValorPlantillaActual(
      new Map([[1, [10, 99]]]),
      new Map([[10, serieActual(1_000)]]), // 99 no tiene ficha en absoluto
    )
    expect(r.valorPlantillaActual.get(1)).toBe(1_000)
    expect(r.jugadoresSinValorActual.get(1)).toEqual([99])
  })

  it('calcula el valor de cada equipo de forma independiente', () => {
    const r = calcularValorPlantillaActual(
      new Map([[1, [10]], [2, [11]]]),
      new Map([[10, serieActual(1_000)], [11, serieActual(2_000)]]),
    )
    expect(r.valorPlantillaActual.get(1)).toBe(1_000)
    expect(r.valorPlantillaActual.get(2)).toBe(2_000)
  })

  it('un equipo sin ningún jugador sin valor no aparece en jugadoresSinValorActual', () => {
    const r = calcularValorPlantillaActual(new Map([[1, [10]]]), new Map([[10, serieActual(1_000)]]))
    expect(r.jugadoresSinValorActual.has(1)).toBe(false)
  })
})
