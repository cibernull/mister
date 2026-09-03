import { describe, expect, it } from 'vitest'
import { extraerHechos, type Volcado } from '../../src/actualizacion/feed.js'

const pagina = (offset: number, capturadaEn: string, eventos: unknown[]): Volcado['paginas'][number] => ({
  offset,
  capturadaEn,
  cuerpo: JSON.stringify({ status: 'ok', data: eventos }),
})

const traspaso = (over: Record<string, unknown> = {}) => ({
  category: 'transfer',
  created: '2026-08-10 12:00:00',
  data: [
    {
      id_transfer: 1,
      id: 100,
      name: 'Un Jugador',
      from: 'Equipo A',
      to: 'Equipo B',
      id_uc_from: 11,
      id_uc_to: 22,
      price: 1_000_000,
      type: 'normal',
      value: 900_000,
      points: 10,
      avg: 5,
      streak: '4,6,-',
      ...over,
    },
  ],
})

describe('extraerHechos', () => {
  it('deduplica un traspaso que aparece en dos páginas de la misma captura', () => {
    const h = extraerHechos({
      paginas: [pagina(0, '2026-09-03T10:00:00Z', [traspaso()]), pagina(20, '2026-09-03T10:00:01Z', [traspaso()])],
    })
    expect(h.traspasos).toHaveLength(1)
  })

  it('se queda con el valor de la captura más reciente, no con el de la primera', () => {
    // El feed reescribe el valor del jugador con el de hoy cada vez que se
    // pide. Con recolección incremental, las páginas viejas conservan el de
    // entonces: quedarse con ellas congelaría los valores para siempre.
    const h = extraerHechos({
      paginas: [
        pagina(0, '2026-09-03T10:00:00Z', [traspaso({ value: 900_000 })]),
        pagina(0, '2026-09-04T10:00:00Z', [traspaso({ value: 1_250_000 })]),
      ],
    })
    expect(h.traspasos).toHaveLength(1)
    expect(h.traspasos[0]!.valor).toBe(1_250_000)
  })

  it('ordena los traspasos por fecha aunque las páginas lleguen al revés', () => {
    const h = extraerHechos({
      paginas: [
        pagina(0, '2026-09-03T10:00:00Z', [traspaso({ id_transfer: 2 })]),
        pagina(20, '2026-09-03T10:00:01Z', [
          { ...traspaso({ id_transfer: 1 }), created: '2026-08-01 09:00:00' },
        ]),
      ],
    })
    expect(h.traspasos.map((t) => t.idTransfer)).toEqual([1, 2])
  })

  it('solo cuenta como salida al que se va de LaLiga, no al que cambia de club', () => {
    const h = extraerHechos({
      paginas: [
        pagina(0, '2026-09-03T10:00:00Z', [
          { category: 'player_transfer', created: '2026-08-19 10:00:00', data: [{ id: 5, id_team_to: 0 }] },
          { category: 'player_transfer', created: '2026-08-20 10:00:00', data: [{ id: 6, id_team_to: 12 }] },
        ]),
      ],
    })
    expect(h.salidas.map((s) => s.idJugador)).toEqual(['5'])
  })

  it('lee del mercado la cláusula, el dueño y los partidos jugados', () => {
    const h = extraerHechos({
      paginas: [
        pagina(0, '2026-09-03T10:00:00Z', [
          {
            category: 'market_unified',
            created: '2026-09-03 10:00:00',
            data: {
              market: [
                {
                  player: {
                    id: 77,
                    name: 'Otro',
                    value: 2_000_000,
                    prev_value: 1_800_000,
                    average: 6.5,
                    points: 13,
                    streak: [4, 9],
                    clause: { value: 3_000_000, multiplier: 1.5 },
                    ownerId: 42,
                  },
                },
              ],
            },
          },
        ]),
      ],
    })
    expect(h.mercado).toEqual([
      {
        idJugador: '77',
        nombre: 'Otro',
        valor: 2_000_000,
        valorPrevio: 1_800_000,
        media: 6.5,
        puntos: 13,
        partidos: 2,
        clausula: 3_000_000,
        idDuenio: 42,
      },
    ])
  })

  it('un cierre de jornada sin clasificación es un error, no una jornada sin premios', () => {
    // Devolver premios en cero falsearía el saldo de los ocho equipos sin que
    // nada lo delatara.
    expect(() =>
      extraerHechos({
        paginas: [
          pagina(0, '2026-09-03T10:00:00Z', [
            {
              category: 'gameweek_end',
              created: '2026-09-01 10:45:05',
              data: { id_gameweek: 1, gameweek: 1, ranking: { ranking: { positions: [] } } },
            },
          ]),
        ],
      }),
    ).toThrow(/no trae clasificación/)
  })

  it('una página sin data no aporta nada y no rompe', () => {
    const h = extraerHechos({
      paginas: [{ offset: 0, capturadaEn: '2026-09-03T10:00:00Z', cuerpo: JSON.stringify({ status: 'end' }) }],
    })
    expect(h.traspasos).toHaveLength(0)
    expect(h.hasta).toBeNull()
  })

  it('un importe que no es número no pasa por bueno', () => {
    expect(() =>
      extraerHechos({ paginas: [pagina(0, '2026-09-03T10:00:00Z', [traspaso({ price: null })])] }),
    ).toThrow(/price/)
  })
})
