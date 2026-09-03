import { describe, expect, it } from 'vitest'
import { abrirAlmacen } from '../../src/almacen/crudo.js'
import { RecoleccionIncompletaError } from '../../src/recoleccion/integridad.js'
import { recolectarHistorico } from '../../src/recoleccion/recolectar.js'
import type { Cliente } from '../../src/recoleccion/cliente.js'

const ruido = (n: number) =>
  JSON.stringify({
    status: 'ok',
    data: Array.from({ length: n }, (_, i) => ({
      category: 'player_transfer',
      created: '2026-09-01 10:00:00',
      id: 1_000_000 + i,
      data: {},
    })),
  })

/** Lote final real: `status: "end"`, sin campo `data` en absoluto. */
const fin = JSON.stringify({ status: 'end' })

/** Sesión caducada a mitad de recorrido: 401, sin campo `data`. No es un fin de histórico. */
const expirada = JSON.stringify({ status: 'error', popup: false })

/**
 * Un evento bruto `transfer` con DOS movimientos. Sirve para distinguir el
 * recuento de eventos brutos (1, lo que avanza el offset del feed) del
 * recuento de eventos de dominio tras parsear (2 transacciones). Caso
 * equivalente al de `tests/cli/importar.test.ts`.
 */
const transferConDosMovimientos = JSON.stringify({
  status: 'ok',
  data: [
    {
      category: 'transfer',
      created: '2026-09-01 10:00:00',
      id: 42,
      data: [
        {
          id: 101,
          id_transfer: 1,
          id_uc_from: 0,
          id_uc_to: 10,
          price: 5,
          type: 'normal',
          from: 'Mister',
          to: 'Equipo A',
          name: 'Jugador 1',
        },
        {
          id: 102,
          id_transfer: 2,
          id_uc_from: 10,
          id_uc_to: 20,
          price: 7,
          type: 'normal',
          from: 'Equipo A',
          to: 'Equipo B',
          name: 'Jugador 2',
        },
      ],
    },
  ],
})

/** Cliente falso que sirve lotes por offset. */
function clienteCon(lotes: Record<number, string>): Cliente {
  return { async pedirLote(offset: number) { return lotes[offset] ?? fin } }
}

describe('recolectarHistorico', () => {
  it('recorre hasta agotar el histórico', async () => {
    const almacen = abrirAlmacen(':memory:')
    const resumen = await recolectarHistorico({
      cliente: clienteCon({ 0: ruido(21), 21: ruido(21), 42: fin }),
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
      cliente: clienteCon({ 0: ruido(21), 21: fin }),
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
      cliente: clienteCon({ 0: ruido(3), 3: fin }),
      almacen,
    })

    expect(resumen.eventos).toBe(3)
    expect(resumen.ruido).toBe(3)
    expect(resumen.contables).toBe(0)
    almacen.cerrar()
  })

  it('se detiene al alcanzar el límite de lotes, pero no da la recolección por completa', async () => {
    const almacen = abrirAlmacen(':memory:')
    const lotes: Record<number, string> = {}
    for (let i = 0; i < 50; i++) lotes[i * 21] = ruido(21)

    // El feed tiene más lotes que ofrecer (50 disponibles); maxLotes corta el
    // recorrido en 5, así que nunca llega al marcador de fin. Continuidad
    // pasa (los 5 lotes encajan sin hueco), pero completitud no: por eso
    // debe lanzar en vez de devolver un resumen normal.
    await expect(
      recolectarHistorico({ cliente: clienteCon(lotes), almacen, maxLotes: 5, recoleccion: 'r1' }),
    ).rejects.toThrow(RecoleccionIncompletaError)

    // Los 5 lotes procesados hasta el límite quedan guardados de todos modos.
    expect(almacen.leerCapturas('r1')).toHaveLength(5)
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

    await expect(
      recolectarHistorico({ cliente: clienteCon(lotes), almacen, maxLotes: 5, recoleccion: 'limite' }),
    ).rejects.toThrow(RecoleccionIncompletaError)

    const completo = await recolectarHistorico({
      cliente: clienteCon({ 0: ruido(21), 21: fin }),
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

  it('termina limpiamente al llegar al lote final real ("status":"end", sin "data"), y lo guarda con nEventos: 0', async () => {
    const almacen = abrirAlmacen(':memory:')
    const resumen = await recolectarHistorico({
      cliente: clienteCon({ 0: ruido(21), 21: fin }),
      almacen,
      recoleccion: 'r1',
    })

    expect(resumen.agotado).toBe(true)
    expect(resumen.lotes).toBe(2)

    const capturas = almacen.leerCapturas('r1')
    expect(capturas).toHaveLength(2)
    const ultima = capturas[1]!
    expect(ultima.offset).toBe(21)
    expect(ultima.cuerpo).toBe(fin)
    expect(ultima.nEventos).toBe(0)
    almacen.cerrar()
  })

  it('falla si un lote intermedio devuelve "status":"error" (sesión caducada), en vez de darse por terminada', async () => {
    const almacen = abrirAlmacen(':memory:')

    await expect(
      recolectarHistorico({
        cliente: clienteCon({ 0: ruido(21), 21: expirada }),
        almacen,
        recoleccion: 'r1',
      }),
    ).rejects.toThrow()

    // El primer lote, legítimo, ya quedó guardado; el fallo no debe leerse
    // como un histórico agotado.
    const capturas = almacen.leerCapturas('r1')
    expect(capturas).toHaveLength(1)
    expect(capturas[0]!.offset).toBe(0)
    almacen.cerrar()
  })

  it('avanza el offset por eventos brutos consumidos, no por transacciones de dominio ya expandidas', async () => {
    const almacen = abrirAlmacen(':memory:')
    const offsetsPedidos: number[] = []
    const cliente: Cliente = {
      async pedirLote(offset: number) {
        offsetsPedidos.push(offset)
        if (offset === 0) return transferConDosMovimientos
        return fin
      },
    }

    const resumen = await recolectarHistorico({ cliente, almacen, recoleccion: 'r1' })

    // Un solo evento bruto "transfer" (aunque contenga 2 movimientos): el
    // siguiente lote debe pedirse en el offset 1 (el recuento bruto), no en
    // el 2 (las 2 transacciones de dominio ya expandidas). Pedir el offset 2
    // saltaría eventos reales del feed en silencio.
    expect(offsetsPedidos).toEqual([0, 1])

    // El resumen, en cambio, sí cuenta las 2 transacciones ya expandidas.
    expect(resumen.eventos).toBe(2)
    expect(resumen.contables).toBe(2)
    almacen.cerrar()
  })

  it('falla si el lote final ("status":"end") trae, contra lo esperado, un campo "data"', async () => {
    const almacen = abrirAlmacen(':memory:')
    const finConDataInesperada = JSON.stringify({ status: 'end', data: [] })

    await expect(
      recolectarHistorico({ cliente: clienteCon({ 0: finConDataInesperada }), almacen, recoleccion: 'r1' }),
    ).rejects.toThrow()

    expect(almacen.leerCapturas('r1')).toHaveLength(0)
    almacen.cerrar()
  })

  it('marca la recolección como completa en el almacén cuando el histórico se agota', async () => {
    const almacen = abrirAlmacen(':memory:')
    await recolectarHistorico({
      cliente: clienteCon({ 0: ruido(21), 21: fin }),
      almacen,
      recoleccion: 'r1',
    })

    const veredicto = almacen.leerCompletitud('r1')
    expect(veredicto?.completa).toBe(true)
    almacen.cerrar()
  })

  it('marca la recolección como incompleta en el almacén cuando se alcanza el límite de lotes sin agotar el feed', async () => {
    const almacen = abrirAlmacen(':memory:')
    const lotes: Record<number, string> = {}
    for (let i = 0; i < 50; i++) lotes[i * 21] = ruido(21)

    await expect(
      recolectarHistorico({ cliente: clienteCon(lotes), almacen, maxLotes: 5, recoleccion: 'r1' }),
    ).rejects.toThrow(RecoleccionIncompletaError)

    const veredicto = almacen.leerCompletitud('r1')
    expect(veredicto?.completa).toBe(false)
    almacen.cerrar()
  })

  it('cuenta los eventos brutos por separado de los eventos de dominio, y su total cuadra con el offset final', async () => {
    const almacen = abrirAlmacen(':memory:')
    const resumen = await recolectarHistorico({
      cliente: clienteCon({ 0: ruido(21), 21: ruido(5), 26: fin }),
      almacen,
      recoleccion: 'r1',
    })

    // Sin transfers de varios movimientos en este caso, brutos y de dominio
    // coinciden; lo relevante es que el campo existe y refleja el offset
    // final (21 + 5 = 26), no el número de lotes ni una cifra distinta.
    expect(resumen.eventosBrutos).toBe(26)
    expect(resumen.eventos).toBe(26)
    almacen.cerrar()
  })
})
