import { describe, expect, it } from 'vitest'
import { recolectarUniverso, PASADAS_MAXIMAS } from '../../src/actualizacion/recolectar.js'
import type { Cliente } from '../../src/recoleccion/cliente.js'

/** Un jugador tal y como lo devuelve el buscador de Mister. */
const jug = (id: number) => ({
  id: String(id),
  name: `Jugador ${id}`,
  position: 3,
  id_team: 1,
  value: 1_000_000,
  points: 0,
  avg: 0,
  streak: [],
  id_uc: null,
})

const respuesta = (js: ReturnType<typeof jug>[]) => JSON.stringify({ status: 'ok', data: { players: js } })

/**
 * Un buscador como el de Mister: reordena su lista entre peticiones, así que
 * paginar sobre él se deja gente por el camino. Aquí se simula rotando el
 * censo una posición en cada pasada.
 */
function buscadorQueReordena(total: number, porPagina = 50): Cliente & { peticiones: number; pasadas: number } {
  const censo = Array.from({ length: total }, (_, i) => jug(i + 1))
  let peticiones = 0
  let pasadas = 0
  const cliente = {
    peticiones: 0,
    pasadas: 0,
    async pedirJugadores(offset: number) {
      if (offset === 0) pasadas += 1
      peticiones += 1
      cliente.peticiones = peticiones
      cliente.pasadas = pasadas
      // Rota en CADA petición, que es lo que hace Mister: por eso paginar sobre
      // él pierde gente —quien cruza el cursor hacia atrás no sale nunca—.
      const giro = peticiones % censo.length
      const girado = censo.slice(giro).concat(censo.slice(0, giro))
      return respuesta(girado.slice(offset, offset + porPagina))
    },
    async pedirPagina() { throw new Error('no usado') },
    async pedirFeed() { throw new Error('no usado') },
    async pedirSaldo() { throw new Error('no usado') },
    async pedirJornada() { throw new Error('no usado') },
  } as unknown as Cliente & { peticiones: number; pasadas: number }
  return cliente
}

describe('recolectarUniverso', () => {
  it('los trae a todos aunque el buscador reordene entre peticiones', async () => {
    // Con una sola pasada faltaban jugadores: medido contra Mister el 7 de
    // septiembre de 2026, tres pasadas seguidas dieron 522, 495 y 523.
    const cliente = buscadorQueReordena(523)
    const universo = await recolectarUniverso(cliente)
    expect(universo).toHaveLength(523)
    expect(new Set(universo.map((j) => j.id)).size).toBe(523)
  })

  it('no repite a nadie', async () => {
    const universo = await recolectarUniverso(buscadorQueReordena(120))
    expect(universo.length).toBe(new Set(universo.map((j) => j.id)).size)
  })

  it('para en cuanto una pasada entera no aporta a nadie nuevo', async () => {
    const cliente = buscadorQueReordena(60)
    await recolectarUniverso(cliente)
    // Dos pasadas: la primera trae a todos, la segunda confirma que no faltaba
    // nadie. Gastar las cuatro siempre sería pagar el doble por nada.
    expect(cliente.pasadas).toBeLessThanOrEqual(PASADAS_MAXIMAS)
    expect(cliente.pasadas).toBeGreaterThanOrEqual(2)
  })
})
