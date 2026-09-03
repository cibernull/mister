import { describe, expect, it } from 'vitest'
import { esContable, type Evento } from '../../src/dominio/eventos.js'

const transaccion: Evento = {
  tipo: 'transaccion',
  fecha: '2026-08-30T10:00:00Z',
  jugador: 'Natan Souza',
  origen: { clase: 'equipo', nombre: 'Neky F.C. (Sergio)' },
  destino: { clase: 'mercado' },
  importe: 5712300,
  operacion: 'normal',
}

const cierre: Evento = {
  tipo: 'cierreJornada',
  fecha: '2026-08-31T22:00:00Z',
  jornada: 3,
  resultados: [
    { equipo: 'Cacaculopedopis', premio: 725000, puntos: 29, sinPuntuar: false },
    { equipo: 'Saiyans FC (Fran)', premio: 0, puntos: 0, sinPuntuar: true },
  ],
}

const ruido: Evento = {
  tipo: 'ruido',
  fecha: '2026-09-01T09:00:00Z',
  motivo: 'fichaje de LaLiga real',
}

describe('esContable', () => {
  it('considera contable una transacción', () => {
    expect(esContable(transaccion)).toBe(true)
  })

  it('considera contable un cierre de jornada', () => {
    expect(esContable(cierre)).toBe(true)
  })

  it('no considera contable el ruido', () => {
    expect(esContable(ruido)).toBe(false)
  })
})
