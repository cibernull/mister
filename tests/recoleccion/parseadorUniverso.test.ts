import { describe, expect, it } from 'vitest'
import { parsearJugadores } from '../../src/recoleccion/parseadorUniverso.js'

/** Una respuesta del buscador, con los campos tal como los manda Mister. */
const respuesta = (...players: Record<string, unknown>[]) =>
  JSON.stringify({ status: 'ok', data: { id: false, players } })

const raphinha = {
  id: 48657,
  name: 'Raphinha',
  position: 4,
  id_team: 3,
  points: 47,
  avg: 15.7,
  status: null,
  streak: [12, 17, 18],
  value: 20146000,
  prev_value: 20146000,
  id_uc: null,
  uc_name: null,
  clause: 20146000,
  shield: 0,
}

const oyarzabal = {
  ...raphinha,
  id: 564,
  name: 'Mikel Oyarzabal',
  points: 19,
  avg: 4.8,
  streak: [3, 4, 9, 3],
  value: 16723000,
  prev_value: 16772000,
  id_uc: 13491755,
  uc_name: 'Mario80',
  clause: 25529000,
}

describe('parsearJugadores', () => {
  it('traduce un jugador entero', () => {
    expect(parsearJugadores(respuesta(oyarzabal))).toEqual([
      {
        id: '564',
        nombre: 'Mikel Oyarzabal',
        posicion: 4,
        idClub: 3,
        puntos: 19,
        media: 4.8,
        partidos: 4,
        racha: [3, 4, 9, 3],
        valor: 16723000,
        sube: -49000,
        duenio: 'Mario80',
        clausula: 25529000,
        blindado: false,
        estado: null,
      },
    ])
  })

  it('a un jugador libre no le pone cláusula, aunque Mister mande una', () => {
    // Sin dueño, Mister rellena `clause` con el propio valor. Guardarlo haría
    // creer que a un jugador libre se le puede pagar una cláusula.
    const [j] = parsearJugadores(respuesta(raphinha))
    expect(j!.duenio).toBeNull()
    expect(j!.clausula).toBeNull()
  })

  it('los partidos son los jugados, no las jornadas disputadas', () => {
    // Contar las casillas de la racha —que es lo que se hacía— daba por
    // jugados los partidos que se pasó en el banquillo: Marc Casadó salía con
    // 5 partidos y 0 puntos.
    const banquillo = { ...raphinha, streak: ['-', '-', 8, '-', '-'] }
    const [j] = parsearJugadores(respuesta(banquillo))
    expect(j!.partidos).toBe(1)
    expect(j!.racha).toEqual([null, null, 8, null, null])
  })

  it('la subida del día es el valor de hoy menos el de ayer', () => {
    expect(parsearJugadores(respuesta({ ...raphinha, value: 100, prev_value: 90 }))[0]!.sube).toBe(10)
  })

  it('recoge el blindaje y la lesión', () => {
    const [j] = parsearJugadores(respuesta({ ...oyarzabal, shield: 1, status: 'injury' }))
    expect(j!.blindado).toBe(true)
    expect(j!.estado).toBe('injury')
  })

  it('un jugador sin valor rompe la pasada en vez de contar como cero', () => {
    // Un valor que se cuela como cero deja la plantilla corta y el tope de
    // puja por debajo, sin que nada avise.
    expect(() => parsearJugadores(respuesta({ ...raphinha, value: null }))).toThrow(/jugador 48657: el campo value/)
  })

  it('un dueño sin nombre también rompe', () => {
    expect(() => parsearJugadores(respuesta({ ...oyarzabal, uc_name: null }))).toThrow(/uc_name/)
  })

  it('una respuesta que no es «ok» no se interpreta', () => {
    expect(() => parsearJugadores(JSON.stringify({ status: 'error' }))).toThrow(/respondió status/)
  })

  it('sin lista de jugadores es error, no una lista vacía', () => {
    expect(() => parsearJugadores(JSON.stringify({ status: 'ok', data: {} }))).toThrow(/data\.players/)
  })

  it('lo que no es JSON se dice claramente', () => {
    expect(() => parsearJugadores('<html>caducado</html>')).toThrow(/no es JSON válido/)
  })
})
