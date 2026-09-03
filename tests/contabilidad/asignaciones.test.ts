import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AsignacionesIlegiblesError, leerAsignaciones } from '../../src/contabilidad/asignaciones.js'

function ficheroCon(contenido: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mister-asig-'))
  const ruta = join(dir, 'bajas-asignadas.json')
  writeFileSync(ruta, contenido)
  return ruta
}

const valido = JSON.stringify({
  asignaciones: [{ idJugador: 19977, jugador: 'Ronald Araújo', idUc: 12493763, equipo: 'X', motivo: 'y' }],
})

describe('leerAsignaciones', () => {
  it('lee las asignaciones como un mapa de jugador a equipo', () => {
    expect(leerAsignaciones(ficheroCon(valido)).get(19977)).toBe(12493763)
  })

  it('devuelve un mapa vacío si el fichero no existe', () => {
    expect(leerAsignaciones('/ruta/que/no/existe').size).toBe(0)
  })

  it('acepta un fichero sin asignaciones', () => {
    expect(leerAsignaciones(ficheroCon('{"asignaciones":[]}')).size).toBe(0)
  })

  it('lanza si el fichero no es JSON', () => {
    expect(() => leerAsignaciones(ficheroCon('esto no es json'))).toThrow(AsignacionesIlegiblesError)
  })

  it('lanza si una asignación no trae idJugador entero', () => {
    const malo = JSON.stringify({ asignaciones: [{ idJugador: 'x', idUc: 1 }] })
    expect(() => leerAsignaciones(ficheroCon(malo))).toThrow(/idJugador/i)
  })

  it('lanza si una asignación no trae idUc entero', () => {
    const malo = JSON.stringify({ asignaciones: [{ idJugador: 1, idUc: null }] })
    expect(() => leerAsignaciones(ficheroCon(malo))).toThrow(/idUc/i)
  })

  it('lanza si el mismo jugador se asigna dos veces', () => {
    const malo = JSON.stringify({ asignaciones: [{ idJugador: 1, idUc: 5 }, { idJugador: 1, idUc: 6 }] })
    expect(() => leerAsignaciones(ficheroCon(malo))).toThrow(/dos veces|duplicad/i)
  })
})
