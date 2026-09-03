import { describe, expect, it } from 'vitest'
import { bajasSinDuenio, reconstruirRepartos } from '../../src/contabilidad/reparto.js'
import type { Evento, Transaccion } from '../../src/dominio/eventos.js'

let n = 0
const mov = (
  idJugador: number, deIdUc: number | null, aIdUc: number | null, fecha: string,
): Transaccion => ({
  tipo: 'transaccion', idEvento: ++n, idTransfer: n, fecha,
  jugador: 'J' + idJugador, idJugador,
  origen: deIdUc === null ? { clase: 'mercado' } : { clase: 'equipo', idUc: deIdUc, nombre: 'E' + deIdUc },
  destino: aIdUc === null ? { clase: 'mercado' } : { clase: 'equipo', idUc: aIdUc, nombre: 'E' + aIdUc },
  importe: 100, operacion: 'normal',
})

const baja = (idJugador: number, fecha: string): Evento => ({
  tipo: 'bajaPlantilla', idEvento: ++n, fecha, idJugador, jugador: 'J' + idJugador,
})

describe('reconstruirRepartos', () => {
  it('un jugador vendido sin haberlo comprado era del reparto', () => {
    const r = reconstruirRepartos([mov(10, 1, null, '2026-08-05 10:00:00')], new Map([[1, []]]), new Map())
    expect(r.get(1)!.porVenta).toEqual([10])
    expect(r.get(1)!.jugadores).toContain(10)
  })

  it('un jugador comprado y luego vendido NO era del reparto', () => {
    const eventos = [mov(10, null, 1, '2026-08-04 10:00:00'), mov(10, 1, null, '2026-08-06 10:00:00')]
    expect(reconstruirRepartos(eventos, new Map([[1, []]]), new Map()).get(1)!.jugadores).toEqual([])
  })

  it('un jugador que conserva sin haberlo comprado era del reparto', () => {
    const r = reconstruirRepartos([], new Map([[1, [20]]]), new Map())
    expect(r.get(1)!.porPlantilla).toEqual([20])
  })

  it('un jugador que conserva y sí compró no era del reparto', () => {
    const r = reconstruirRepartos([mov(20, null, 1, '2026-08-04 10:00:00')], new Map([[1, [20]]]), new Map())
    expect(r.get(1)!.jugadores).toEqual([])
  })

  it('una baja de un jugador que nadie tocó queda en porBaja, sin dueño', () => {
    const r = reconstruirRepartos([baja(99, '2026-08-10 10:00:00'), mov(10, 1, null, '2026-08-05 10:00:00')], new Map([[1, []]]), new Map())
    expect(r.get(1)!.porBaja).toEqual([])
    expect([...r.values()].flatMap((x) => x.jugadores)).not.toContain(99)
  })

  it('una baja de un jugador que un equipo tenía se le asigna', () => {
    // El equipo 1 lo compró y nunca lo vendió: cuando causa baja, era suyo.
    const eventos = [mov(30, null, 1, '2026-08-04 10:00:00'), baja(30, '2026-08-10 10:00:00')]
    const r = reconstruirRepartos(eventos, new Map([[1, []]]), new Map())
    // Lo compró, así que NO es del reparto inicial aunque cause baja.
    expect(r.get(1)!.jugadores).toEqual([])
  })

  it('no cuenta dos veces a un jugador vendido y luego recomprado y conservado', () => {
    const eventos = [mov(40, 1, null, '2026-08-05 10:00:00'), mov(40, null, 1, '2026-08-09 10:00:00')]
    const r = reconstruirRepartos(eventos, new Map([[1, [40]]]), new Map())
    expect(r.get(1)!.jugadores).toEqual([40])
  })

  it('separa correctamente a dos equipos', () => {
    const eventos = [mov(10, 1, null, '2026-08-05 10:00:00'), mov(11, 2, null, '2026-08-05 11:00:00')]
    const r = reconstruirRepartos(eventos, new Map([[1, []], [2, []]]), new Map())
    expect(r.get(1)!.jugadores).toEqual([10])
    expect(r.get(2)!.jugadores).toEqual([11])
  })

  it('un traspaso entre equipos por cláusula no hace al jugador del reparto del comprador', () => {
    const eventos = [mov(50, 1, 2, '2026-08-05 10:00:00')]
    const r = reconstruirRepartos(eventos, new Map([[1, []], [2, [50]]]), new Map())
    expect(r.get(1)!.jugadores).toEqual([50])
    expect(r.get(2)!.jugadores).toEqual([])
  })
})

describe('vía 3: bajas asignadas a mano', () => {
  it('una baja asignada entra en el reparto de su equipo', () => {
    const eventos = [baja(19977, '2026-08-10 10:00:00')]
    const r = reconstruirRepartos(eventos, new Map([[1, []]]), new Map([[19977, 1]]))
    expect(r.get(1)!.porBaja).toEqual([19977])
    expect(r.get(1)!.jugadores).toContain(19977)
  })

  it('una baja sin asignar no entra en ningún reparto', () => {
    const eventos = [baja(19977, '2026-08-10 10:00:00')]
    const r = reconstruirRepartos(eventos, new Map([[1, []]]), new Map())
    expect([...r.values()].flatMap((x) => x.jugadores)).not.toContain(19977)
  })

  it('una baja de un jugador que el equipo había comprado no entra, aunque esté asignada', () => {
    const eventos = [mov(30, null, 1, '2026-08-04 10:00:00'), baja(30, '2026-08-10 10:00:00')]
    const r = reconstruirRepartos(eventos, new Map([[1, []]]), new Map([[30, 1]]))
    expect(r.get(1)!.jugadores).toEqual([])
  })

  it('no cuenta dos veces una baja asignada que además se vendió', () => {
    const eventos = [mov(40, 1, null, '2026-08-05 10:00:00'), baja(40, '2026-08-10 10:00:00')]
    const r = reconstruirRepartos(eventos, new Map([[1, []]]), new Map([[40, 1]]))
    expect(r.get(1)!.jugadores).toEqual([40])
  })

  it('lanza si una baja se asigna a un equipo que no existe', () => {
    const eventos = [baja(19977, '2026-08-10 10:00:00')]
    expect(() => reconstruirRepartos(eventos, new Map([[1, []]]), new Map([[19977, 999]]))).toThrow(/999/)
  })
})

describe('bajasSinDuenio', () => {
  it('lista las bajas que ningún reparto reclama', () => {
    const eventos = [baja(19977, '2026-08-10 10:00:00'), baja(88, '2026-08-11 10:00:00')]
    const repartos = reconstruirRepartos(eventos, new Map([[1, []]]), new Map([[88, 1]]))
    expect(bajasSinDuenio(eventos, repartos)).toEqual([19977])
  })

  it('no lista una baja de un jugador que un equipo compró y sí movió', () => {
    const eventos = [mov(30, null, 1, '2026-08-04 10:00:00'), baja(30, '2026-08-10 10:00:00')]
    const repartos = reconstruirRepartos(eventos, new Map([[1, []]]), new Map())
    expect(bajasSinDuenio(eventos, repartos)).toEqual([])
  })

  it('no lista una baja de un jugador que un equipo vendió sin haberlo comprado', () => {
    // El jugador era del reparto inicial de un equipo (lo vendió sin comprarlo
    // antes), y luego causa baja: su dueño consta en el feed, no es incertidumbre.
    const eventos = [mov(60, 1, null, '2026-08-05 10:00:00'), baja(60, '2026-08-10 10:00:00')]
    const repartos = reconstruirRepartos(eventos, new Map([[1, []]]), new Map())
    expect(bajasSinDuenio(eventos, repartos)).toEqual([])
  })
})
