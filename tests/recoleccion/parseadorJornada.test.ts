import { describe, expect, it } from 'vitest'
import { parsearAlineacion, parsearJornadasConocidas } from '../../src/recoleccion/parseadorJornada.js'

const jugador = (id: number, nombre: string, position: number, points: number | null, played = 1) =>
  ({ id, name: nombre, position, points, played, captain: 0 })

const respuesta = JSON.stringify({
  status: 'ok',
  data: {
    gameweeks: [
      { id: 3968, gameweek: 1, status: 'finished' },
      { id: 3969, gameweek: 2, status: 'finished' },
      { id: 3973, gameweek: 6, status: 'pending' },
    ],
    gameweek_user: { points: 38, rank: 3 },
    lineup: {
      positions: {
        1: { 1: jugador(53111, 'Álvaro Valles', 1, 8) },
        2: { 1: jugador(1, 'Un defensa', 2, 5), 2: jugador(2, 'Otro defensa', 2, 2) },
        3: { 1: jugador(3, 'Un medio', 3, 4) },
        4: { 1: jugador(4, 'Iago Aspas', 4, 9) },
      },
    },
    bench: [jugador(9, 'Uno del banquillo', 3, 11)],
  },
})

describe('parsearJornadasConocidas', () => {
  it('saca el id interno de cada jornada, que es como se piden', () => {
    // Pedirlas por su número devuelve siempre la jornada en curso, sin error:
    // así es como se tienen cinco veces la misma creyendo que son cinco.
    expect(parsearJornadasConocidas(respuesta)).toEqual([
      { jornada: 1, id: 3968, estado: 'finished' },
      { jornada: 2, id: 3969, estado: 'finished' },
      { jornada: 6, id: 3973, estado: 'pending' },
    ])
  })
})

describe('parsearAlineacion', () => {
  const a = parsearAlineacion(respuesta, 1, 3968)

  it('trae el once entero, en orden de puesto', () => {
    expect(a.once).toHaveLength(5)
    expect(a.once.map((j) => j.puesto)).toEqual([1, 2, 2, 3, 4])
    expect(a.once[0]!.nombre).toBe('Álvaro Valles')
  })

  it('deduce la formación contando cada línea, que Mister no la publica', () => {
    expect(a.formacion).toBe('1-2-1-1')
  })

  it('guarda los puntos de cada uno y los del equipo', () => {
    expect(a.puntos).toBe(38)
    expect(a.puesto).toBe(3)
    expect(a.once.map((j) => j.puntos)).toEqual([8, 5, 2, 4, 9])
  })

  it('y el banquillo, que también puntúa a la vista', () => {
    expect(a.banquillo).toHaveLength(1)
    expect(a.banquillo[0]!.puntos).toBe(11)
  })

  it('distingue no haber jugado de haber hecho cero', () => {
    const conCero = JSON.stringify({
      data: { lineup: { positions: { 1: { 1: jugador(7, 'Portero', 1, 0, 1) }, 2: { 1: jugador(8, 'Suplente', 2, null, 0) } } }, bench: [] },
    })
    const b = parsearAlineacion(conCero, 2, 3969)
    expect(b.once[0]).toMatchObject({ puntos: 0, jugo: true })
    expect(b.once[1]).toMatchObject({ puntos: null, jugo: false })
  })
})
