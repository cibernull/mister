import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CategoriaDesconocidaError,
  OperacionDesconocidaError,
  parsearPaginaFeed,
} from '../../src/recoleccion/parseadorFeed.js'
import { esContable, type BajaPlantilla, type CierreJornada, type Transaccion } from '../../src/dominio/eventos.js'

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

  it('extrae idTransfer e idEvento (entero) en cada transacción de la página real', () => {
    const ts = transaccionesDe(pagina0)
    expect(ts.length).toBeGreaterThan(0)
    for (const t of ts) {
      expect(Number.isInteger(t.idTransfer)).toBe(true)
      expect(Number.isInteger(t.idEvento)).toBe(true)
    }
  })

  it('extrae idUc en las partes de clase equipo', () => {
    const ts = transaccionesDe(pagina0)
    const conEquipo = ts.flatMap((t) => [t.origen, t.destino]).filter((p) => p.clase === 'equipo')
    expect(conEquipo.length).toBeGreaterThan(0)
    for (const p of conEquipo) {
      if (p.clase === 'equipo') expect(Number.isInteger(p.idUc)).toBe(true)
    }
  })

  it('toda transacción del fixture real trae el identificador del jugador', () => {
    const ts = transaccionesDe(pagina0)
    expect(ts.length).toBeGreaterThan(0)
    for (const t of ts) expect(Number.isInteger(t.idJugador)).toBe(true)
  })

  it('todo cierre del fixture real trae el identificador de la jornada', () => {
    const cs = cierresDe(paginaCierre)
    expect(cs.length).toBeGreaterThan(0)
    for (const c of cs) expect(Number.isInteger(c.idJornada)).toBe(true)
  })

  it('extrae idUc, valorPlantilla (teamValue) e idEvento en el cierre de jornada real', () => {
    const cs = cierresDe(paginaCierre)
    expect(cs.length).toBeGreaterThan(0)
    for (const c of cs) {
      expect(Number.isInteger(c.idEvento)).toBe(true)
      for (const r of c.resultados) {
        expect(Number.isInteger(r.idUc)).toBe(true)
        expect(Number.isInteger(r.valorPlantilla)).toBe(true)
        expect(r.valorPlantilla).toBeGreaterThan(0)
      }
    }
  })

  describe('parte(): la identidad mercado/equipo exige un entero, nunca Number(x) === 0', () => {
    const transferCon = (movimiento: Record<string, unknown>) =>
      JSON.stringify({
        status: 'ok',
        data: [{ category: 'transfer', created: '2026-09-03 10:00:00', id: 1, data: [movimiento] }],
      })

    it('lanza si id_uc_from es null, en vez de clasificarlo como mercado (Number(null) === 0)', () => {
      const cuerpo = transferCon({
        id_transfer: 1,
        id_uc_from: null,
        id_uc_to: 5,
        from: 'Mister',
        to: 'Equipo',
        price: 100,
        type: 'normal',
        name: 'Jugador',
      })
      expect(() => parsearPaginaFeed(cuerpo)).toThrow(/id_uc_from/)
    })

    it('lanza si id_uc_from es una cadena vacía, en vez de clasificarlo como mercado (Number("") === 0)', () => {
      const cuerpo = transferCon({
        id_transfer: 1,
        id_uc_from: '',
        id_uc_to: 5,
        from: 'Mister',
        to: 'Equipo',
        price: 100,
        type: 'normal',
        name: 'Jugador',
      })
      expect(() => parsearPaginaFeed(cuerpo)).toThrow(/id_uc_from/)
    })

    it('lanza si id_uc_from es false, en vez de clasificarlo como mercado (Number(false) === 0)', () => {
      const cuerpo = transferCon({
        id_transfer: 1,
        id_uc_from: false,
        id_uc_to: 5,
        from: 'Mister',
        to: 'Equipo',
        price: 100,
        type: 'normal',
        name: 'Jugador',
      })
      expect(() => parsearPaginaFeed(cuerpo)).toThrow(/id_uc_from/)
    })

    it('lanza si falta id_uc_from, en vez de clasificarlo como equipo con nombre vacío (Number(undefined) es NaN)', () => {
      const cuerpo = JSON.stringify({
        status: 'ok',
        data: [
          {
            category: 'transfer',
            created: '2026-09-03 10:00:00',
            id: 1,
            data: [
              { id_transfer: 1, id_uc_to: 5, from: 'Mister', to: 'Equipo', price: 100, type: 'normal', name: 'Jugador' },
            ],
          },
        ],
      })
      expect(() => parsearPaginaFeed(cuerpo)).toThrow(/id_uc_from/)
    })

    it('lanza si el equipo de una parte no trae nombre, en vez de producir un nombre vacío', () => {
      const cuerpo = transferCon({
        id_transfer: 1,
        id_uc_from: 0,
        id_uc_to: 5,
        from: 'Mister',
        price: 100,
        type: 'normal',
        name: 'Jugador',
        // "to" ausente: id_uc_to=5 no es mercado, así que hace falta nombre de equipo.
      })
      expect(() => parsearPaginaFeed(cuerpo)).toThrow(/campo to /)
    })
  })

  it('lanza si a una transacción le falta "created", en vez de producir fecha vacía', () => {
    const cuerpo = JSON.stringify({
      status: 'ok',
      data: [
        {
          category: 'transfer',
          id: 1,
          data: [
            { id_transfer: 1, id_uc_from: 0, id_uc_to: 5, from: 'Mister', to: 'Equipo', price: 100, type: 'normal', name: 'Jugador' },
          ],
        },
      ],
    })
    expect(() => parsearPaginaFeed(cuerpo)).toThrow(/created/)
  })

  it('lanza si a un movimiento le falta el nombre del jugador, en vez de producir un nombre vacío', () => {
    const cuerpo = JSON.stringify({
      status: 'ok',
      data: [
        {
          category: 'transfer',
          created: '2026-09-03 10:00:00',
          id: 1,
          data: [{ id_transfer: 1, id_uc_from: 0, id_uc_to: 5, from: 'Mister', to: 'Equipo', price: 100, type: 'normal' }],
        },
      ],
    })
    expect(() => parsearPaginaFeed(cuerpo)).toThrow(/name/)
  })

  it('lanza si una posición del cierre de jornada no trae "user", en vez de producir un equipo con nombre vacío', () => {
    const datos = {
      gameweek: 6,
      ranking: {
        ranking: {
          positions: [{ idUc: 999, payment: 0, points: 10, negative: false, teamValue: 1000000 }],
        },
      },
    }
    expect(() => parsearPaginaFeed(gameweekEndCon(datos))).toThrow(/user/)
  })

  it('lanza si el "user" de una posición no trae "name", en vez de producir un equipo con nombre vacío', () => {
    const datos = {
      gameweek: 6,
      ranking: {
        ranking: {
          positions: [
            { idUc: 999, user: { email: null }, payment: 0, points: 10, negative: false, teamValue: 1000000 },
          ],
        },
      },
    }
    expect(() => parsearPaginaFeed(gameweekEndCon(datos))).toThrow(/name/)
  })

  it('lanza si "negative" no es un booleano, en vez de degradar con Boolean (donde Boolean("false") es true)', () => {
    const datos = {
      gameweek: 6,
      ranking: {
        ranking: {
          positions: [
            {
              idUc: 999,
              user: { name: 'Equipo' },
              payment: 0,
              points: 10,
              negative: 'false',
              teamValue: 1000000,
            },
          ],
        },
      },
    }
    expect(() => parsearPaginaFeed(gameweekEndCon(datos))).toThrow(/negative/)
  })

  it('ningún mensaje de error por "name" vacío en el user de una posición filtra el email del rival', () => {
    const emailSecreto = 'rival-secreto-name-vacio@example.com'
    const datos = {
      gameweek: 6,
      ranking: {
        ranking: {
          positions: [
            {
              idUc: 999,
              user: { name: '', email: emailSecreto, apple_id: 'apple-id-secreto-456' },
              payment: 0,
              points: 10,
              negative: false,
              teamValue: 1000000,
            },
          ],
        },
      },
    }

    // No se usa expect.unreachable() dentro de un try/catch que lo envuelve:
    // si parsearPaginaFeed no lanzara, ese expect.unreachable() lanzaría a su
    // vez y quedaría atrapado por el mismo catch, dejando pasar el test sin
    // haber comprobado nada. Se captura el error por fuera, en su lugar.
    let error: Error | undefined
    try {
      parsearPaginaFeed(gameweekEndCon(datos))
    } catch (e) {
      error = e as Error
    }

    expect(error, 'debería haber lanzado por name vacío').toBeDefined()
    expect(error!.message).not.toContain(emailSecreto)
    expect(error!.message).not.toContain('apple-id-secreto-456')
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

  const feedCon = (evento: Record<string, unknown>) =>
    JSON.stringify({ status: 'ok', data: [evento] })

  const playerTransfer = (datos: Record<string, unknown>) => feedCon({
    category: 'player_transfer', id: 1, created: '2026-08-10 10:00:00', data: [datos],
  })

  describe('bajas de plantilla', () => {
    it('un player_transfer sin equipo es una baja, no ruido', () => {
      const { eventos } = parsearPaginaFeed(playerTransfer({ id: 19977, name: 'Ronald Araújo', id_team: 0 }))
      expect(eventos).toHaveLength(1)
      expect(eventos[0]!.tipo).toBe('bajaPlantilla')
    })

    it('la baja conserva el identificador y el nombre del jugador', () => {
      const { eventos } = parsearPaginaFeed(playerTransfer({ id: 19977, name: 'Ronald Araújo', id_team: 0 }))
      const b = eventos[0] as BajaPlantilla
      expect(b.idJugador).toBe(19977)
      expect(b.jugador).toBe('Ronald Araújo')
    })

    it('trata id_team ausente o nulo igual que cero', () => {
      for (const datos of [{ id: 1, name: 'X' }, { id: 1, name: 'X', id_team: null }]) {
        expect(parsearPaginaFeed(playerTransfer(datos)).eventos[0]!.tipo).toBe('bajaPlantilla')
      }
    })

    it('un player_transfer CON equipo sigue siendo ruido', () => {
      const { eventos } = parsearPaginaFeed(playerTransfer({ id: 5, name: 'Y', id_team: 6 }))
      expect(eventos[0]!.tipo).toBe('ruido')
    })

    it('una baja no es contable: no mueve dinero', () => {
      const { eventos } = parsearPaginaFeed(playerTransfer({ id: 1, name: 'X', id_team: 0 }))
      expect(esContable(eventos[0]!)).toBe(false)
    })

    it('el histórico real contiene bajas de plantilla', () => {
      const bajas = parsearPaginaFeed(pagina0).eventos.filter((e) => e.tipo === 'bajaPlantilla')
      expect(bajas.length).toBeGreaterThan(0)
    })

    describe('id_team con forma inesperada: lanza, nunca se resuelve por coacción numérica', () => {
      it('lanza si id_team es un array, en vez de clasificarlo como baja (Number([]) === 0)', () => {
        expect(() =>
          parsearPaginaFeed(playerTransfer({ id: 1, name: 'X', id_team: [] })),
        ).toThrow(/id_team/)
      })

      it('lanza si id_team es una cadena no numérica, en vez de perder el evento (Number("N/A") es NaN)', () => {
        expect(() =>
          parsearPaginaFeed(playerTransfer({ id: 1, name: 'X', id_team: 'N/A' })),
        ).toThrow(/id_team/)
      })

      it('lanza si id_team es la cadena numérica "0", en vez de tratarla como el entero 0', () => {
        expect(() =>
          parsearPaginaFeed(playerTransfer({ id: 1, name: 'X', id_team: '0' })),
        ).toThrow(/id_team/)
      })

      it('lanza si id_team es un número decimal, en vez de truncarlo a entero', () => {
        expect(() =>
          parsearPaginaFeed(playerTransfer({ id: 1, name: 'X', id_team: 6.5 })),
        ).toThrow(/id_team/)
      })

      it('lanza si id_team es un entero negativo, en vez de clasificarlo en silencio como ruido', () => {
        expect(() =>
          parsearPaginaFeed(playerTransfer({ id: 1, name: 'X', id_team: -1 })),
        ).toThrow(/id_team/)
      })

      it('el mensaje de error no vuelca el objeto crudo del movimiento', () => {
        let error: Error | undefined
        try {
          parsearPaginaFeed(playerTransfer({ id: 1, name: 'X', id_team: 'N/A', fb_id1: 'facebook-secreto-789' }))
        } catch (e) {
          error = e as Error
        }
        expect(error, 'debería haber lanzado por id_team inválido').toBeDefined()
        expect(error!.message).not.toContain('facebook-secreto-789')
      })
    })
  })
})
