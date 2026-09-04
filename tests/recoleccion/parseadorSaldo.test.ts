import { describe, expect, it } from 'vitest'
import { parsearSaldo, reinicioDeLiga, SaldoIlegibleError } from '../../src/recoleccion/parseadorSaldo.js'

const apunte = (o: Partial<Record<string, unknown>> = {}) => ({
  ts: 1788560011,
  adate: '05/09/2026 – 00:13',
  rdate: 'hace 45 minutos',
  reason: 'Modificación de cláusula (100%) de Oriol Rey',
  sign: '',
  amount: -203800,
  type: 'Penalización',
  balance: 11929000,
  ...o,
})

const respuesta = (balance: number, history: unknown[]) =>
  JSON.stringify({ status: 'ok', data: { balance, history } })

describe('parsearSaldo', () => {
  it('traduce un apunte entero', () => {
    expect(parsearSaldo(respuesta(11929000, [apunte()]))).toEqual({
      saldo: 11929000,
      apuntes: [
        {
          cuando: 1788560011,
          fecha: '2026-09-05 00:13',
          motivo: 'Modificación de cláusula (100%) de Oriol Rey',
          tipo: 'Penalización',
          importe: -203800,
          saldo: 11929000,
        },
      ],
    })
  })

  it('quita el marcado que Mister mete en el motivo', () => {
    const venta = apunte({ reason: 'Fer Niño <span>a</span> Mister', type: 'Venta', amount: 2445040 })
    expect(parsearSaldo(respuesta(1, [venta])).apuntes[0]!.motivo).toBe('Fer Niño a Mister')
  })

  it('la fecha queda ordenable', () => {
    expect(parsearSaldo(respuesta(1, [apunte({ adate: '31/08/2026 – 10:35' })])).apuntes[0]!.fecha).toBe(
      '2026-08-31 10:35',
    )
  })

  it('el importe conserva el signo, que es lo que dice si entró o salió', () => {
    const r = parsearSaldo(respuesta(1, [apunte({ amount: -203800 }), apunte({ amount: 2445040 })]))
    expect(r.apuntes.map((a) => a.importe)).toEqual([-203800, 2445040])
  })

  it('un importe ilegible rompe: es un euro que no se sabe de dónde sale', () => {
    expect(() => parsearSaldo(respuesta(1, [apunte({ amount: null })]))).toThrow(SaldoIlegibleError)
  })

  it('una respuesta que no es «ok» no se interpreta', () => {
    expect(() => parsearSaldo(JSON.stringify({ status: 'error' }))).toThrow(/status/)
  })

  it('lo que no es JSON se dice claramente', () => {
    expect(() => parsearSaldo('<html>caducado</html>')).toThrow(/no es JSON válido/)
  })
})

describe('reinicioDeLiga', () => {
  const reinicio = (ts: number) =>
    apunte({ ts, reason: 'Ajuste de balance por reinicio de liga', amount: -6252000, balance: 21047000 })

  it('encuentra el último ajuste por reinicio', () => {
    // Hay más de uno: el de julio y el de agosto. Manda el último, que es
    // desde donde cuenta la liga en curso.
    const libro = parsearSaldo(respuesta(1, [apunte({ ts: 3 }), reinicio(2), reinicio(1)]))
    expect(reinicioDeLiga(libro)!.cuando).toBe(2)
  })

  it('sin reinicio devuelve null en vez de inventarse uno', () => {
    expect(reinicioDeLiga(parsearSaldo(respuesta(1, [apunte()])))).toBeNull()
  })
})
