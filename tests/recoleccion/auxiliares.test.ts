import { describe, expect, it, vi } from 'vitest'
import { abrirAlmacen } from '../../src/almacen/crudo.js'
import { recolectarAuxiliares } from '../../src/recoleccion/auxiliares.js'
import type { Cliente } from '../../src/recoleccion/cliente.js'

const pagJugador = (v: number) =>
  `<html><script>[{"value":"${v}","date":"3 ago 2026"}]</script></html>`
const pagEquipo = '<html><a href="players/34/x">j</a></html>'

function clienteFalso(): Cliente & { pedidas: string[] } {
  const pedidas: string[] = []
  return {
    pedidas,
    async pedirLote() { throw new Error('no usado') },
    async pedirPagina(ruta: string) {
      pedidas.push(ruta)
      return ruta.includes('/players/') ? pagJugador(1000) : pagEquipo
    },
  } as Cliente & { pedidas: string[] }
}

describe('recolectarAuxiliares', () => {
  it('pide una página por equipo y otra por jugador', async () => {
    const a = abrirAlmacen(':memory:'), c = clienteFalso()
    const r = await recolectarAuxiliares({ cliente: c, almacen: a, idsUc: [1, 2], idsJugador: [34] })
    expect(r.plantillas).toBe(2)
    expect(r.jugadores).toBe(1)
    expect(c.pedidas).toHaveLength(3)
    a.cerrar()
  })

  it('guarda cada página cruda con su ruta', async () => {
    const a = abrirAlmacen(':memory:')
    await recolectarAuxiliares({ cliente: clienteFalso(), almacen: a, idsUc: [1], idsJugador: [] })
    expect(a.leerPagina('/users/1/x')!.cuerpo).toBe(pagEquipo)
    a.cerrar()
  })

  it('no vuelve a pedir una página guardada que sigue fresca', async () => {
    const a = abrirAlmacen(':memory:'), c = clienteFalso()
    await recolectarAuxiliares({ cliente: c, almacen: a, idsUc: [1], idsJugador: [] })
    const r = await recolectarAuxiliares({ cliente: c, almacen: a, idsUc: [1], idsJugador: [] })
    expect(c.pedidas).toHaveLength(1)
    expect(r.yaEnCache).toBe(1)
    a.cerrar()
  })

  it('vuelve a pedir una página cuya captura ha caducado', async () => {
    const a = abrirAlmacen(':memory:'), c = clienteFalso()
    let t = Date.parse('2026-09-03T10:00:00Z')
    const ahora = () => t
    await recolectarAuxiliares({ cliente: c, almacen: a, idsUc: [1], idsJugador: [], ahora })
    t += 13 * 60 * 60 * 1000   // trece horas después
    const r = await recolectarAuxiliares({ cliente: c, almacen: a, idsUc: [1], idsJugador: [], ahora })
    expect(c.pedidas).toHaveLength(2)
    expect(r.plantillas).toBe(1)
    expect(r.yaEnCache).toBe(0)
    a.cerrar()
  })

  it('respeta una edad máxima explícita', async () => {
    const a = abrirAlmacen(':memory:'), c = clienteFalso()
    let t = Date.parse('2026-09-03T10:00:00Z')
    const ahora = () => t
    await recolectarAuxiliares({ cliente: c, almacen: a, idsUc: [1], idsJugador: [], ahora, maxEdadMs: 60_000 })
    t += 61_000
    await recolectarAuxiliares({ cliente: c, almacen: a, idsUc: [1], idsJugador: [], ahora, maxEdadMs: 60_000 })
    expect(c.pedidas).toHaveLength(2)
    a.cerrar()
  })

  it('lanza si una captura guardada tiene la fecha ilegible', async () => {
    const a = abrirAlmacen(':memory:')
    a.guardarPagina({ ruta: '/users/1/x', cuerpo: 'x', capturadaEn: 'no es una fecha' })
    await expect(
      recolectarAuxiliares({ cliente: clienteFalso(), almacen: a, idsUc: [1], idsJugador: [] }),
    ).rejects.toThrow(/ilegible/i)
    a.cerrar()
  })

  it('propaga el error si una página no se puede pedir', async () => {
    const a = abrirAlmacen(':memory:')
    const c = { async pedirLote() { throw new Error('x') }, pedirPagina: vi.fn(async () => { throw new Error('caída') }) } as unknown as Cliente
    await expect(recolectarAuxiliares({ cliente: c, almacen: a, idsUc: [1], idsJugador: [] })).rejects.toThrow(/caída/)
    a.cerrar()
  })
})
