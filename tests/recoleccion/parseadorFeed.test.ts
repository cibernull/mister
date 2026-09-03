import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CategoriaDesconocidaError,
  OperacionDesconocidaError,
  parsearPaginaFeed,
} from '../../src/recoleccion/parseadorFeed.js'
import type { CierreJornada, Transaccion } from '../../src/dominio/eventos.js'

const pagina0 = readFileSync('fixtures/feed-offset-0.json', 'utf8')
const paginaCierre = readFileSync('fixtures/feed-con-cierre-jornada.json', 'utf8')
const paginaFinal = readFileSync('fixtures/feed-final-agotado.json', 'utf8')

const transaccionesDe = (cuerpo: string): Transaccion[] =>
  parsearPaginaFeed(cuerpo).eventos.filter((e): e is Transaccion => e.tipo === 'transaccion')

const cierresDe = (cuerpo: string): CierreJornada[] =>
  parsearPaginaFeed(cuerpo).eventos.filter((e): e is CierreJornada => e.tipo === 'cierreJornada')

const conCategoria = (categoria: string) =>
  JSON.stringify({ status: 'ok', data: [{ category: categoria, created: '2026-09-03 10:00:00', data: [] }] })

describe('parsearPaginaFeed', () => {
  it('extrae eventos de la página real', () => {
    expect(parsearPaginaFeed(pagina0).eventos.length).toBeGreaterThan(0)
  })

  it('produce una transacción por cada movimiento, no por evento', () => {
    // El fixture tiene 7 eventos `transfer` que contienen 8 movimientos.
    expect(transaccionesDe(pagina0)).toHaveLength(8)
  })

  it('toda transacción tiene importe entero no negativo', () => {
    const ts = transaccionesDe(pagina0)
    expect(ts.length).toBeGreaterThan(0)
    for (const t of ts) {
      expect(Number.isInteger(t.importe)).toBe(true)
      expect(t.importe).toBeGreaterThanOrEqual(0)
    }
  })

  it('toda transacción nombra al jugador y a ambas partes', () => {
    const ts = transaccionesDe(pagina0)
    expect(ts.length).toBeGreaterThan(0)
    for (const t of ts) {
      expect(t.jugador).not.toBe('')
      expect(t.origen).toBeDefined()
      expect(t.destino).toBeDefined()
    }
  })

  it('reconoce el mercado cuando id_uc vale 0', () => {
    const ts = transaccionesDe(pagina0)
    const conMercado = ts.filter((t) => t.origen.clase === 'mercado' || t.destino.clase === 'mercado')
    expect(conMercado.length).toBeGreaterThan(0)
  })

  it('nombra los equipos cuando id_uc no es 0', () => {
    const ts = transaccionesDe(pagina0)
    const conEquipo = ts.filter((t) => t.origen.clase === 'equipo' || t.destino.clase === 'equipo')
    expect(conEquipo.length).toBeGreaterThan(0)
    for (const t of conEquipo) {
      if (t.origen.clase === 'equipo') expect(t.origen.nombre).not.toBe('')
      if (t.destino.clase === 'equipo') expect(t.destino.nombre).not.toBe('')
    }
  })

  it('conserva el tipo de operación', () => {
    const ts = transaccionesDe(pagina0)
    expect(ts.length).toBeGreaterThan(0)
    for (const t of ts) {
      expect(['normal', 'clause', 'rescind']).toContain(t.operacion)
    }
  })

  it('la página de cierre trae un cierre con los ocho equipos', () => {
    const cs = cierresDe(paginaCierre)
    expect(cs.length).toBeGreaterThan(0)
    for (const c of cs) {
      expect(c.resultados).toHaveLength(8)
      expect(Number.isInteger(c.jornada)).toBe(true)
    }
  })

  it('todo resultado de jornada trae equipo, premio entero y puntos', () => {
    const cs = cierresDe(paginaCierre)
    expect(cs.length).toBeGreaterThan(0)
    for (const c of cs) {
      for (const r of c.resultados) {
        expect(r.equipo).not.toBe('')
        expect(Number.isInteger(r.premio)).toBe(true)
        expect(Number.isInteger(r.puntos)).toBe(true)
      }
    }
  })

  it('normaliza a cero el premio de quien no cobra', () => {
    const cs = cierresDe(paginaCierre)
    const sinPremio = cs.flatMap((c) => c.resultados).filter((r) => r.premio === 0)
    // En la jornada del fixture hay dos equipos con `payment: null`.
    expect(sinPremio.length).toBeGreaterThan(0)
  })

  it('marca sinPuntuar a quien tiene saldo negativo', () => {
    const cs = cierresDe(paginaCierre)
    const negativos = cs.flatMap((c) => c.resultados).filter((r) => r.sinPuntuar)
    expect(negativos.length).toBeGreaterThan(0)
  })

  it('clasifica player_transfer como ruido', () => {
    const ruido = parsearPaginaFeed(pagina0).eventos.filter((e) => e.tipo === 'ruido')
    expect(ruido.length).toBeGreaterThan(0)
  })

  it('marca agotado cuando status es "end" (sin campo data), y no produce eventos', () => {
    const pagina = parsearPaginaFeed(paginaFinal)
    expect(pagina.agotado).toBe(true)
    expect(pagina.eventos).toEqual([])
  })

  it('no marca agotado en una página con eventos', () => {
    expect(parsearPaginaFeed(pagina0).agotado).toBe(false)
  })

  it('lanza si status es "ok" pero no trae el array data', () => {
    expect(() => parsearPaginaFeed(JSON.stringify({ status: 'ok' }))).toThrow()
  })

  it('lanza si status es "error" (p. ej. sesión caducada, 401), y el mensaje menciona el status', () => {
    const cuerpo = JSON.stringify({ status: 'error', popup: false })
    expect(() => parsearPaginaFeed(cuerpo)).toThrow(/error/)
  })

  it('lanza CategoriaDesconocidaError ante una categoría no catalogada', () => {
    expect(() => parsearPaginaFeed(conCategoria('categoria_inventada'))).toThrow(CategoriaDesconocidaError)
  })

  it('el error de categoría conserva su nombre y el crudo', () => {
    try {
      parsearPaginaFeed(conCategoria('categoria_inventada'))
      expect.unreachable('debería haber lanzado')
    } catch (e) {
      expect(e).toBeInstanceOf(CategoriaDesconocidaError)
      expect((e as CategoriaDesconocidaError).categoria).toBe('categoria_inventada')
      expect((e as CategoriaDesconocidaError).crudo).toContain('categoria_inventada')
    }
  })

  it('lanza OperacionDesconocidaError ante un tipo de operación no catalogado', () => {
    const cuerpo = JSON.stringify({
      status: 'ok',
      data: [
        {
          category: 'transfer',
          created: '2026-09-03 10:00:00',
          data: [
            { id_transfer: 1, id_uc_from: 0, id_uc_to: 5, from: 'Mister', to: 'Equipo', price: 100, type: 'permuta_inventada', name: 'Jugador' },
          ],
        },
      ],
    })
    expect(() => parsearPaginaFeed(cuerpo)).toThrow(OperacionDesconocidaError)
  })

  it('lanza si un movimiento no trae price entero', () => {
    const cuerpo = JSON.stringify({
      status: 'ok',
      data: [
        {
          category: 'transfer',
          created: '2026-09-03 10:00:00',
          data: [
            { id_transfer: 1, id_uc_from: 0, id_uc_to: 5, from: 'Mister', to: 'Equipo', price: null, type: 'normal', name: 'Jugador' },
          ],
        },
      ],
    })
    expect(() => parsearPaginaFeed(cuerpo)).toThrow(/price/i)
  })

  it('lanza si el data de un evento transfer no es una lista de movimientos', () => {
    const cuerpo = JSON.stringify({
      status: 'ok',
      data: [
        {
          category: 'transfer',
          created: '2026-09-03 10:00:00',
          // Forma inesperada: ni ausente ni array. Un transfer sin movimientos
          // no es legítimo: debe lanzar, no producir cero transacciones.
          data: { motivo: 'forma inesperada' },
        },
      ],
    })
    expect(() => parsearPaginaFeed(cuerpo)).toThrow()
  })

  it('lanza si el data de un evento transfer es una lista vacía', () => {
    const cuerpo = JSON.stringify({
      status: 'ok',
      data: [{ category: 'transfer', created: '2026-09-03 10:00:00', data: [] }],
    })
    expect(() => parsearPaginaFeed(cuerpo)).toThrow()
  })

  const gameweekEndCon = (data: unknown) =>
    JSON.stringify({
      status: 'ok',
      data: [{ category: 'gameweek_end', created: '2026-09-03 10:00:00', data }],
    })

  it('lanza si a un gameweek_end le falta el nivel ranking', () => {
    expect(() => parsearPaginaFeed(gameweekEndCon({ gameweek: 6 }))).toThrow(/ranking/)
  })

  it('lanza si a un gameweek_end le falta el nivel ranking.ranking', () => {
    expect(() => parsearPaginaFeed(gameweekEndCon({ gameweek: 6, ranking: {} }))).toThrow(/ranking/)
  })

  it('lanza si un gameweek_end trae positions vacío: un cierre sin equipos no es legítimo', () => {
    const datos = { gameweek: 6, ranking: { ranking: { positions: [] } } }
    expect(() => parsearPaginaFeed(gameweekEndCon(datos))).toThrow(/positions|vacío/i)
  })

  it('ningún mensaje de error del parseo de un cierre de jornada filtra el email de un rival', () => {
    const emailSecreto = 'rival-secreto-no-debe-aparecer@example.com'
    const datos = {
      gameweek: 6,
      ranking: {
        ranking: {
          positions: [
            {
              idUc: 999,
              user: { name: 'Equipo Rival', email: emailSecreto, apple_id: 'apple-id-secreto-123' },
              payment: 0,
              points: 'no-es-un-entero', // fuerza el fallo de validación
              negative: false,
            },
          ],
        },
      },
    }

    try {
      parsearPaginaFeed(gameweekEndCon(datos))
      expect.unreachable('debería haber lanzado por points inválido')
    } catch (e) {
      const mensaje = (e as Error).message
      expect(mensaje).not.toContain(emailSecreto)
      expect(mensaje).not.toContain('apple-id-secreto-123')
    }
  })
})
