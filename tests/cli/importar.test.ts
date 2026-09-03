import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { abrirAlmacen } from '../../src/almacen/crudo.js'
import { importarVolcado } from '../../src/cli/importar.js'
import { RecoleccionIncompletaError } from '../../src/recoleccion/integridad.js'

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
const vacio = JSON.stringify({ status: 'ok', data: [] })
/** Lote final real: `status: "end"`, sin campo `data` en absoluto. */
const fin = JSON.stringify({ status: 'end' })

/**
 * Un evento bruto `transfer` con DOS movimientos. Sirve para distinguir el
 * recuento de eventos brutos (1, lo que avanza el offset del feed) del
 * recuento de eventos de dominio tras parsear (2 transacciones).
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

function volcadoCon(paginas: { offset: number; cuerpo: string }[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'mister-volcado-'))
  const ruta = join(dir, 'volcado-feed.json')
  writeFileSync(
    ruta,
    JSON.stringify({ paginas: paginas.map((p) => ({ ...p, capturadaEn: '2026-09-03T10:00:00Z' })) }),
  )
  return ruta
}

/** Escribe un fichero de volcado con la forma literal indicada, sin normalizar nada. */
function escribirVolcadoCrudo(contenido: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'mister-volcado-'))
  const ruta = join(dir, 'volcado-feed.json')
  writeFileSync(ruta, JSON.stringify(contenido))
  return ruta
}

describe('importarVolcado', () => {
  it('guarda todos los lotes del volcado', async () => {
    const almacen = abrirAlmacen(':memory:')
    const resumen = await importarVolcado(
      volcadoCon([
        { offset: 0, cuerpo: ruido(21) },
        { offset: 21, cuerpo: fin },
      ]),
      almacen,
      'r1',
    )

    expect(resumen.lotes).toBe(2)
    expect(almacen.leerCapturas('r1').map((c) => c.offset)).toEqual([0, 21])
    almacen.cerrar()
  })

  it('cuenta los eventos igual que la recolección directa', async () => {
    const almacen = abrirAlmacen(':memory:')
    const resumen = await importarVolcado(
      volcadoCon([
        { offset: 0, cuerpo: ruido(3) },
        { offset: 3, cuerpo: fin },
      ]),
      almacen,
      'r1',
    )

    expect(resumen.eventos).toBe(3)
    expect(resumen.eventosBrutos).toBe(3)
    expect(resumen.ruido).toBe(3)
    almacen.cerrar()
  })

  it('guarda nEventos como el recuento de eventos brutos, no el de movimientos expandidos', async () => {
    const almacen = abrirAlmacen(':memory:')
    const resumen = await importarVolcado(
      volcadoCon([
        { offset: 0, cuerpo: transferConDosMovimientos },
        { offset: 1, cuerpo: fin },
      ]),
      almacen,
      'r1',
    )

    const capturas = almacen.leerCapturas('r1')
    // Un solo evento bruto "transfer" (aunque contenga 2 movimientos): el
    // offset del feed avanza según eventos brutos consumidos, no según
    // transacciones de dominio. Si nEventos guardara 2, esta importación con
    // el segundo lote en offset 1 (correcto) fallaría por discontinuidad.
    expect(capturas[0]!.nEventos).toBe(1)
    expect(capturas[1]!.offset).toBe(1)

    // El resumen, en cambio, sí cuenta las 2 transacciones ya expandidas.
    expect(resumen.eventos).toBe(2)
    expect(resumen.contables).toBe(2)
    almacen.cerrar()
  })

  it('rechaza un volcado con discontinuidad', async () => {
    const almacen = abrirAlmacen(':memory:')
    await expect(
      importarVolcado(
        volcadoCon([
          { offset: 0, cuerpo: ruido(21) },
          { offset: 99, cuerpo: vacio },
        ]),
        almacen,
        'r1',
      ),
    ).rejects.toThrow(/no es continuo/i)
    almacen.cerrar()
  })

  it('rechaza páginas tras el fin del histórico, aunque no colisionen en offset', async () => {
    const almacen = abrirAlmacen(':memory:')
    await expect(
      importarVolcado(
        volcadoCon([
          { offset: 0, cuerpo: ruido(21) },
          { offset: 21, cuerpo: fin },
          { offset: 99, cuerpo: ruido(3) },
        ]),
        almacen,
        'r1',
      ),
    ).rejects.toThrow(/no es continuo/i)
    almacen.cerrar()
  })

  it('no depende del orden de las páginas en el fichero', async () => {
    const almacen = abrirAlmacen(':memory:')
    const resumen = await importarVolcado(
      volcadoCon([
        { offset: 21, cuerpo: fin },
        { offset: 0, cuerpo: ruido(21) },
      ]),
      almacen,
      'r1',
    )

    expect(resumen.lotes).toBe(2)
    expect(almacen.leerCapturas('r1').map((c) => c.offset)).toEqual([0, 21])
    almacen.cerrar()
  })

  it('rechaza un volcado sin el array "paginas"', async () => {
    const ruta = escribirVolcadoCrudo({ algoDistinto: true })
    const almacen = abrirAlmacen(':memory:')
    await expect(importarVolcado(ruta, almacen, 'r1')).rejects.toThrow(/paginas/i)
    almacen.cerrar()
  })

  it('rechaza una página sin "cuerpo"', async () => {
    const ruta = escribirVolcadoCrudo({
      paginas: [{ offset: 0, capturadaEn: '2026-09-03T10:00:00Z' }],
    })
    const almacen = abrirAlmacen(':memory:')
    await expect(importarVolcado(ruta, almacen, 'r1')).rejects.toThrow()
    expect(almacen.leerCapturas('r1')).toHaveLength(0)
    almacen.cerrar()
  })

  it('usa "volcado:<nombre del fichero>" como recolección por defecto', async () => {
    const ruta = volcadoCon([{ offset: 0, cuerpo: fin }])
    const almacen = abrirAlmacen(':memory:')
    await importarVolcado(ruta, almacen)

    expect(almacen.recolecciones()).toEqual([`volcado:${basename(ruta)}`])
    almacen.cerrar()
  })

  it('marca agotado cuando el volcado llega al fin real del histórico', async () => {
    const almacen = abrirAlmacen(':memory:')
    const resumen = await importarVolcado(
      volcadoCon([
        { offset: 0, cuerpo: ruido(21) },
        { offset: 21, cuerpo: fin },
      ]),
      almacen,
      'r1',
    )
    expect(resumen.agotado).toBe(true)
    almacen.cerrar()
  })

  it('marca la recolección como completa en el almacén cuando el volcado llega al fin real', async () => {
    const almacen = abrirAlmacen(':memory:')
    await importarVolcado(
      volcadoCon([
        { offset: 0, cuerpo: ruido(21) },
        { offset: 21, cuerpo: fin },
      ]),
      almacen,
      'r1',
    )

    const veredicto = almacen.leerCompletitud('r1')
    expect(veredicto?.completa).toBe(true)
    almacen.cerrar()
  })

  it('lanza si el volcado no llega al fin del histórico ("status":"end"), y no se da por buena la importación', async () => {
    const almacen = abrirAlmacen(':memory:')
    await expect(
      importarVolcado(
        volcadoCon([
          { offset: 0, cuerpo: ruido(21) },
          { offset: 21, cuerpo: vacio },
        ]),
        almacen,
        'r1',
      ),
    ).rejects.toThrow(RecoleccionIncompletaError)

    // Los lotes ya quedan guardados en "capturas", pero el veredicto de
    // completitud debe reflejar que la recolección NO se da por buena.
    expect(almacen.leerCapturas('r1')).toHaveLength(2)
    expect(almacen.leerCompletitud('r1')?.completa).toBe(false)
    almacen.cerrar()
  })

  it('falla si el lote final ("status":"end") trae, contra lo esperado, un campo "data"', async () => {
    const almacen = abrirAlmacen(':memory:')
    const finConDataInesperada = JSON.stringify({ status: 'end', data: [] })

    await expect(
      importarVolcado(volcadoCon([{ offset: 0, cuerpo: finConDataInesperada }]), almacen, 'r1'),
    ).rejects.toThrow()

    expect(almacen.leerCapturas('r1')).toHaveLength(0)
    almacen.cerrar()
  })

  it('falla en vez de contar cero eventos si la respuesta no tiene el array "data"', async () => {
    const almacen = abrirAlmacen(':memory:')
    const sinData = JSON.stringify({ status: 'error' })

    await expect(
      importarVolcado(volcadoCon([{ offset: 0, cuerpo: sinData }]), almacen, 'r1'),
    ).rejects.toThrow(/forma esperada/i)

    expect(almacen.leerCapturas('r1')).toHaveLength(0)
    almacen.cerrar()
  })
})
