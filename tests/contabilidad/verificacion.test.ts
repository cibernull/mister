import { describe, expect, it } from 'vitest'
import { verificarSaldoPropio, verificarTopePropio, verificarMarcasNegativas } from '../../src/contabilidad/verificacion.js'
import type { EstadoEquipo } from '../../src/contabilidad/motor.js'
import type { DatosUsuario } from '../../src/recoleccion/parseadorFgUser.js'
import type { Evento } from '../../src/dominio/eventos.js'

const estado = (idUc: number, saldo: number, topePuja = 0): EstadoEquipo => ({
  idUc, nombre: 'E', valorReparto: 0, saldoInicial: 0, premios: 0, ventas: 0,
  compras: 0, saldo, topePuja, jugadoresSinValor: [],
})

const usuario = (saldo: number, topePuja: number): DatosUsuario => ({
  idUsuario: 1, idUc: 1, idComunidad: 1, equipo: 'E', saldo,
  saldoFuturo: saldo, topePuja, creditos: 0, formacion: '', tope: 0,
})

const cierre = (idUc: number, jornada: number, fecha: string, negativo: boolean): Evento => ({
  tipo: 'cierreJornada', idEvento: jornada, idJornada: jornada, jornada, fecha,
  resultados: [{ idUc, equipo: 'E', premio: 0, puntos: 0, valorPlantilla: 0, sinPuntuar: negativo }],
})

describe('verificarSaldoPropio', () => {
  it('no devuelve nada si coincide', () => {
    expect(verificarSaldoPropio(estado(1, 9209955), usuario(9209955, 0))).toBe(null)
  })

  it('devuelve la discrepancia con su desvío', () => {
    const d = verificarSaldoPropio(estado(1, 9210755), usuario(9209955, 0))
    expect(d).not.toBe(null)
    expect(d!.desvio).toBe(800)
    expect(d!.calculado).toBe(9210755)
    expect(d!.real).toBe(9209955)
  })

  it('el desvío es siempre positivo, calcule de más o de menos', () => {
    expect(verificarSaldoPropio(estado(1, 9209155), usuario(9209955, 0))!.desvio).toBe(800)
  })
})

describe('verificarTopePropio', () => {
  it('no devuelve nada si coincide al euro', () => {
    expect(verificarTopePropio(estado(1, 0, 28556455), usuario(0, 28556455))).toBe(null)
  })

  it('detecta cualquier diferencia', () => {
    expect(verificarTopePropio(estado(1, 0, 28556000), usuario(0, 28556455))!.desvio).toBe(455)
  })
})

describe('verificarMarcasNegativas', () => {
  it('cuenta un acierto cuando el saldo negativo coincide con la marca', () => {
    const eventos = [cierre(1, 3, '2026-09-01 10:00:00', true)]
    const r = verificarMarcasNegativas(eventos, () => new Map([[1, estado(1, -8407740)]]))
    expect(r.aciertos).toBe(1)
    expect(r.fallos).toBe(0)
  })

  it('cuenta un acierto cuando el saldo positivo coincide con la ausencia de marca', () => {
    const eventos = [cierre(1, 3, '2026-09-01 10:00:00', false)]
    const r = verificarMarcasNegativas(eventos, () => new Map([[1, estado(1, 5000)]]))
    expect(r.aciertos).toBe(1)
  })

  it('cuenta un fallo y lo detalla cuando no coinciden', () => {
    const eventos = [cierre(1, 2, '2026-08-25 10:00:00', false)]
    const r = verificarMarcasNegativas(eventos, () => new Map([[1, estado(1, -17877)]]))
    expect(r.fallos).toBe(1)
    expect(r.detalle[0]!.saldoCalculado).toBe(-17877)
    expect(r.detalle[0]!.jornada).toBe(2)
    expect(r.detalle[0]!.misterDiceNegativo).toBe(false)
  })

  it('recorre todas las jornadas y todos los equipos', () => {
    const eventos: Evento[] = [
      { tipo: 'cierreJornada', idEvento: 1, idJornada: 1, jornada: 1, fecha: '2026-08-20 12:00:00',
        resultados: [
          { idUc: 1, equipo: 'A', premio: 0, puntos: 0, valorPlantilla: 0, sinPuntuar: false },
          { idUc: 2, equipo: 'B', premio: 0, puntos: 0, valorPlantilla: 0, sinPuntuar: false }] },
      cierre(1, 2, '2026-08-25 12:00:00', false),
    ]
    const r = verificarMarcasNegativas(eventos, () => new Map([[1, estado(1, 100)], [2, estado(2, 100)]]))
    expect(r.aciertos + r.fallos).toBe(3)
  })

  it('ignora los equipos que el motor no conoce', () => {
    const eventos = [cierre(9, 1, '2026-08-20 12:00:00', false)]
    const r = verificarMarcasNegativas(eventos, () => new Map())
    expect(r.aciertos + r.fallos).toBe(0)
  })
})
