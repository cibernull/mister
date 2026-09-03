import { describe, expect, it } from 'vitest'
import { abrirAlmacen } from '../../src/almacen/crudo.js'
import { recolectarHistorico } from '../../src/recoleccion/recolectar.js'
import type { Cliente } from '../../src/recoleccion/cliente.js'

const ruido = (n: number) =>
  JSON.stringify({
    status: 'ok',
    data: Array.from({ length: n }, () => ({
      category: 'player_transfer',
      created: '2026-09-01 10:00:00',
      data: {},
    })),
  })

const vacio = JSON.stringify({ status: 'ok', data: [] })

/** Cliente falso que sirve lotes por offset. */
function clienteCon(lotes: Record<number, string>): Cliente {
  return { async pedirLote(offset: number) { return lotes[offset] ?? vacio } }
}

describe('recolectarHistorico', () => {
  it('recorre hasta agotar el histórico', async () => {
    const almacen = abrirAlmacen(':memory:')
    const resumen = await recolectarHistorico({
      cliente: clienteCon({ 0: ruido(21), 21: ruido(21), 42: vacio }),
      almacen,
      recoleccion: 'r1',
    })

    expect(resumen.lotes).toBe(3)
    expect(resumen.recoleccion).toBe('r1')
    expect(almacen.leerCapturas('r1').map((c) => c.offset)).toEqual([0, 21, 42])
    almacen.cerrar()
  })

  it('guarda el cuerpo crudo y el número de eventos de cada lote', async () => {
    const almacen = abrirAlmacen(':memory:')
    await recolectarHistorico({
      cliente: clienteCon({ 0: ruido(21), 21: vacio }),
      almacen,
      recoleccion: 'r1',
    })

    const primera = almacen.leerCapturas('r1')[0]!
    expect(primera.cuerpo).toBe(ruido(21))
    expect(primera.nEventos).toBe(21)
    almacen.cerrar()
  })

  it('cuenta eventos contables y ruido por separado', async () => {
    const almacen = abrirAlmacen(':memory:')
    const resumen = await recolectarHistorico({
      cliente: clienteCon({ 0: ruido(3), 3: vacio }),
      almacen,
    })

    expect(resumen.eventos).toBe(3)
    expect(resumen.ruido).toBe(3)
    expect(resumen.contables).toBe(0)
    almacen.cerrar()
  })

  it('se detiene al alcanzar el límite de lotes', async () => {
    const almacen = abrirAlmacen(':memory:')
    const lotes: Record<number, string> = {}
    for (let i = 0; i < 50; i++) lotes[i * 21] = ruido(21)

    const resumen = await recolectarHistorico({ cliente: clienteCon(lotes), almacen, maxLotes: 5 })
    expect(resumen.lotes).toBe(5)
    almacen.cerrar()
  })

  it('propaga el error si una categoría no está catalogada', async () => {
    const almacen = abrirAlmacen(':memory:')
    const desconocida = JSON.stringify({
      status: 'ok',
      data: [{ category: 'inventada', created: '2026-09-01 10:00:00', data: {} }],
    })

    await expect(
      recolectarHistorico({ cliente: clienteCon({ 0: desconocida }), almacen, recoleccion: 'r1' }),
    ).rejects.toThrow(/no catalogada/i)
    almacen.cerrar()
  })

  it('guarda el lote crudo aunque su contenido no se pueda interpretar', async () => {
    const almacen = abrirAlmacen(':memory:')
    const desconocida = JSON.stringify({
      status: 'ok',
      data: [{ category: 'inventada', created: '2026-09-01 10:00:00', data: {} }],
    })

    await expect(
      recolectarHistorico({ cliente: clienteCon({ 0: desconocida }), almacen, recoleccion: 'r1' }),
    ).rejects.toThrow()

    // El crudo se guarda antes de interpretar, para poder diagnosticarlo.
    expect(almacen.leerCapturas('r1')).toHaveLength(1)
    almacen.cerrar()
  })

  it('distingue agotar el histórico de alcanzar el límite de lotes', async () => {
    const almacen = abrirAlmacen(':memory:')
    const lotes: Record<number, string> = {}
    for (let i = 0; i < 50; i++) lotes[i * 21] = ruido(21)

    const conLimite = await recolectarHistorico({ cliente: clienteCon(lotes), almacen, maxLotes: 5, recoleccion: 'limite' })
    expect(conLimite.agotado).toBe(false)

    const completo = await recolectarHistorico({
      cliente: clienteCon({ 0: ruido(21), 21: vacio }),
      almacen,
      recoleccion: 'completo',
    })
    expect(completo.agotado).toBe(true)
    almacen.cerrar()
  })

  it('falla en vez de contar cero eventos si la respuesta no tiene el array "data"', async () => {
    const almacen = abrirAlmacen(':memory:')
    const sinData = JSON.stringify({ status: 'error' })

    await expect(
      recolectarHistorico({ cliente: clienteCon({ 0: sinData }), almacen, recoleccion: 'r1' }),
    ).rejects.toThrow(/forma esperada/i)

    // No debe haberse guardado como si tuviera 0 eventos y tratado como fin de histórico.
    expect(almacen.leerCapturas('r1')).toHaveLength(0)
    almacen.cerrar()
  })
})
